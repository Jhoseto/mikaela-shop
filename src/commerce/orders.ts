import type { PoolClient } from "pg";
import { z } from "zod";
import { basketAmounts } from "./bundles";
import { claimLine } from "./order-line";
import { tx } from "@/db";
import type { Actor } from "@/auth/access";
import { ShopError, amountFor, digest, enqueue } from "./checkout";
import { effectivePrice, offerJoin, siteDefaults, today } from "./catalog";

const transitions: Record<string, { from: string[]; to: string }> = {
  confirm: { from: ["new"], to: "confirmed" },
  prepare: { from: ["confirmed"], to: "preparing" },
  ready: { from: ["preparing"], to: "ready" },
  dispatch: { from: ["ready"], to: "on_route" },
  deliver: { from: ["on_route", "problem"], to: "delivered" },
  problem: { from: ["on_route"], to: "problem" },
  wait: { from: ["confirmed", "preparing"], to: "waiting" },
};
const text = (s: unknown, max = 500) =>
  String(s ?? "")
    .trim()
    .slice(0, max);
const uuid = (v: unknown) => z.uuid().safeParse(v).success;
function fail(s: string): never {
  throw new ShopError(s, 409);
}
function reason(p: any) {
  if (!text(p.reason)) fail("Посочете причина.");
  return text(p.reason);
}
async function event(
  c: PoolClient,
  id: string,
  actor: string,
  kind: string,
  detail: any = {},
) {
  await c.query(
    "INSERT INTO order_events(order_id,actor,kind,detail) VALUES($1,$2,$3,$4)",
    [id, actor, kind, detail],
  );
  await c.query(
    "INSERT INTO audit_log(actor,action,entity,detail) VALUES($1,$2,$3,$4)",
    [actor, kind, id, detail],
  );
}
async function cancelOrder(
  c: PoolClient,
  o: any,
  actor: string,
  message: string,
) {
  if (o.status === "cancelled") return;
  if (o.status === "delivered")
    fail("Доставена поръчка изисква отказ или рекламация.");
  if (!o.capacity_released)
    await c.query(
      "UPDATE delivery_slots SET reserved=reserved-1 WHERE id=$1 AND reserved>0",
      [o.slot_id],
    );
  await c.query(
    "UPDATE orders SET status='cancelled',capacity_released=true,updated_at=now() WHERE id=$1",
    [o.id],
  );
  await event(c, o.id, actor, "cancelled", { reason: message });
  if (o.customer.email)
    await enqueue(c, o.id, "cancelled", "email", { reason: message });
}
async function editItem(
  c: PoolClient,
  o: any,
  p: any,
  actor: Actor,
  site: any,
) {
  if (!["preparing", "waiting"].includes(o.status) || !uuid(p.itemId))
    fail("Артикулите се редактират по време на подготовка.");
  const i = (
    await c.query(
      "SELECT * FROM order_items WHERE order_id=$1 AND id=$2 FOR UPDATE",
      [o.id, p.itemId],
    )
  ).rows[0];
  if (!i) fail("Артикулът не е намерен.");
  const contacts = Array.isArray(i.change_detail.contacts)
    ? i.change_detail.contacts
    : [];
  const approval =
    p.approval && text(p.approval.by) && text(p.approval.channel)
      ? {
          by: text(p.approval.by),
          channel: text(p.approval.channel),
          at: new Date().toISOString(),
        }
      : null;
  const status = text(p.status);
  let prepared = Number(p.quantity ?? i.quantity);
  let source = i.snapshot;
  if (!["prepared", "replaced", "missing"].includes(status))
    fail("Невалиден статус за артикул.");
  if (status === "missing") {
    if (i.substitution === "call" && !approval) {
      const attempts = Math.max(1, Number(site.contactAttempts));
      const waited =
        contacts.length > 0 &&
        Date.now() - Date.parse(contacts.at(-1).at) >=
          Number(site.contactWaitMinutes) * 60000;
      if (contacts.length < attempts || !waited)
        fail(
          "Изчаква се решение на клиента или приключване на опитите за връзка.",
        );
    }
    prepared = 0;
  } else {
    if (
      !Number.isFinite(prepared) ||
      prepared <= 0 ||
      prepared > 10000 ||
      Math.abs(prepared * 1000 - Math.round(prepared * 1000)) > 0.000001
    )
      fail("Невалидно подготвено количество.");
    if (status === "replaced") {
      if (i.substitution !== "call") fail("Клиентът е избрал пропускане при липса.");
      if (!approval || !uuid(p.variantId) || p.variantId === i.variant_id)
        fail(
          "Замяната изисква конкретен различен вариант и записано съгласие.",
        );
      const date =
        site.promoBasis === "order"
          ? new Intl.DateTimeFormat("sv-SE", {
              timeZone: "Europe/Sofia",
            }).format(o.created_at)
          : o.delivery_snapshot.day;
      const v = (
        await c.query(
          `SELECT v.*,p.name product_name,p.slug,p.brand,cat.name category_name,(p.food||v.food) food,active.offer
           FROM variants v JOIN products p ON p.id=v.product_id JOIN categories cat ON cat.id=p.category_id
           ${offerJoin} WHERE v.id=$2 AND v.available AND p.available AND p.status='published' FOR SHARE OF v,p`,
          [date, p.variantId],
        )
      ).rows[0];
      if (!v || (v.food.ageRestricted && !site.ageEnabled))
        fail("Заместващият вариант е недостъпен.");
      const pr = effectivePrice(v, date);
      if (pr.price_cents === null) fail("Няма цена за заместващия вариант.");
      if (v.online_limit != null) {
        const { rows: [other] } = await c.query(
          `SELECT coalesce(sum(coalesce(prepared_quantity,quantity)),0) quantity FROM order_items
           WHERE order_id=$1 AND id<>$2 AND status<>'missing'
           AND coalesce(change_detail->'prepared'->>'variantId',variant_id::text)=$3`,
          [o.id, i.id, v.id],
        );
        if (prepared + Number(other.quantity) > Number(v.online_limit))
          fail("Замяната надвишава лимита на този вариант за една онлайн поръчка.");
      }
      source = {
        productId: v.product_id,
        slug: v.slug,
        brand: v.brand,
        categoryName: v.category_name,
        variantId: v.id,
        productName: v.product_name,
        variantName: v.name,
        pack: v.pack,
        food: v.food,
        unit: v.unit,
        unitCents: pr.price_cents,
        regularCents:
          v.local_cents != null && (!v.local_until || v.local_until >= date)
            ? v.local_cents
            : v.regular_cents,
        offer: pr.offer,
        terms: pr.offer?.terms || "",
      };
    }
    if (source.unit === "piece" && !Number.isInteger(prepared))
      fail("Броят трябва да е цяло число.");
    if (
      prepared >
        Number(i.quantity) * (1 + Number(i.weight_tolerance) / 100) +
          0.0000001 &&
      !approval
    )
      fail("Увеличението изисква записано съгласие.");
  }
  const amount = amountFor(
    source.unitCents,
    prepared,
    source.offer,
    source.regularCents,
  );
  const detail = {
    ...i.change_detail,
    contacts,
    approval,
    reason: text(p.reason),
    prepared: source,
  };
  await c.query(
    "UPDATE order_items SET status=$3,prepared_quantity=$4,line_cents=$5,change_detail=$6 WHERE order_id=$1 AND id=$2",
    [o.id, i.id, status, prepared, amount, detail],
  );
  const lines = (
    await c.query(
      "SELECT id,variant_id,quantity,prepared_quantity,snapshot,change_detail,line_cents FROM order_items WHERE order_id=$1 ORDER BY id",
      [o.id],
    )
  ).rows;
  const allocations = basketAmounts(
    lines.map((line) => {
      const price = line.change_detail?.prepared || line.snapshot;
      return {
        ...price,
        variantId: price.variantId || line.variant_id,
        quantity: Number(line.prepared_quantity ?? line.quantity),
      };
    }),
  );
  for (const [idx, line] of lines.entries()) {
    if (line.line_cents !== allocations[idx])
      await c.query("UPDATE order_items SET line_cents=$2 WHERE id=$1", [
        line.id,
        allocations[idx],
      ]);
  }
  const totals = (
    await c.query(
      "SELECT sum(line_cents)::int subtotal,bool_and(status='missing') empty FROM order_items WHERE order_id=$1",
      [o.id],
    )
  ).rows[0];
  await c.query(
    "UPDATE orders SET subtotal_cents=$2,total_cents=$2+delivery_cents+extra_cents,updated_at=now() WHERE id=$1",
    [o.id, totals.subtotal],
  );
  await event(c, o.id, actor.id, "item", {
    itemId: i.id,
    status,
    quantity: prepared,
    lineCents: allocations[lines.findIndex((line) => line.id === i.id)],
    variantId: source.variantId,
    approval,
    reason: text(p.reason),
  });
  if (totals.empty)
    await cancelOrder(c, o, actor.id, "Всички артикули са изчерпани.");
}
export async function changeOrder(
  orderId: string,
  action: string,
  p: any,
  actor: Actor,
) {
  if (!uuid(orderId)) throw new ShopError("Невалидна поръчка.", 404);
  return tx(async (c) => {
    const o = (
      await c.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId])
    ).rows[0];
    const isStaff = actor.roles.some((r) => ["owner", "staff"].includes(r));
    if (
      !o ||
      (!isStaff &&
        (!actor.roles.includes("courier") ||
          o.assigned_to !== actor.id ||
          !["deliver", "problem", "payment"].includes(action)))
    )
      throw new ShopError("Няма достъп до поръчката.", 403);
    const site = {
      ...siteDefaults,
      ...(await c.query("SELECT value FROM settings WHERE key='site'")).rows[0]
        ?.value,
    };
    if (transitions[action]) {
      const t = transitions[action];
      if (!t.from.includes(o.status))
        fail("Това действие не е достъпно при текущия статус.");
      if (
        action === "ready" &&
        (
          await c.query(
            "SELECT 1 FROM order_items WHERE order_id=$1 AND status='requested' LIMIT 1",
            [o.id],
          )
        ).rowCount
      )
        fail("Отбележете подготвените количества за всички артикули.");
      if (action === "dispatch" && !o.assigned_to)
        fail("Първо възложете доставката на доставчик.");
      if (
        action === "deliver" &&
        (
          await c.query(
            "SELECT 1 FROM order_items WHERE order_id=$1 AND status<>'missing' AND coalesce(change_detail->'prepared'->'food'->>'ageRestricted',snapshot->'food'->>'ageRestricted')='true' LIMIT 1",
            [o.id],
          )
        ).rowCount &&
        !p.ageChecked
      )
        fail("Проверете възрастта при предаване.");
      if (["wait", "problem"].includes(action)) reason(p);
      await c.query(
        "UPDATE orders SET previous_status=status,status=$2,prepared_by=CASE WHEN $2='preparing' THEN $3 ELSE prepared_by END,updated_at=now() WHERE id=$1",
        [o.id, t.to, actor.id],
      );
      await event(c, o.id, actor.id, t.to, {
        reason: text(p.reason),
        ageChecked: !!p.ageChecked,
      });
      if (
        ["confirmed", "ready", "delivered"].includes(t.to) &&
        o.customer.email
      )
        await enqueue(c, o.id, t.to, "email", {});
    } else if (action === "resume") {
      if (!["waiting", "problem"].includes(o.status))
        fail("Поръчката не е временно спряна.");
      const resumed =
        o.status === "problem"
          ? "on_route"
          : o.previous_status === "confirmed"
            ? "confirmed"
            : "preparing";
      await c.query(
        "UPDATE orders SET status=$2,updated_at=now() WHERE id=$1",
        [o.id, resumed],
      );
      await event(c, o.id, actor.id, resumed, { reason: text(p.reason) });
    } else if (action === "cancel") {
      await cancelOrder(c, o, actor.id, reason(p));
    } else if (action === "assign") {
      if (
        ["delivered", "cancelled"].includes(o.status) ||
        !(
          await c.query(
            "SELECT 1 FROM staff_roles WHERE user_id=$1 AND role='courier'",
            [p.courierId],
          )
        ).rowCount
      )
        fail("Изберете действащ доставчик за отворена поръчка.");
      await c.query(
        "UPDATE orders SET assigned_to=$2,updated_at=now() WHERE id=$1",
        [o.id, p.courierId],
      );
      await event(c, o.id, actor.id, "assign", { courierId: p.courierId });
    } else if (action === "move") {
      if (
        !uuid(p.slotId) ||
        ["cancelled", "on_route", "delivered", "problem"].includes(o.status)
      )
        fail("Интервалът не може да се промени.");
      if (p.slotId === o.slot_id) return { ok: true };
      await c.query(
        "SELECT id FROM delivery_slots WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[p.slotId, o.slot_id]],
      );
      const slot = (
        await c.query(
          `UPDATE delivery_slots s SET reserved=reserved+1 FROM delivery_zones z WHERE z.id=s.zone_id AND z.active AND s.id=$1 AND s.zone_id=$2 AND s.active AND s.reserved<s.capacity AND (s.day+s.start_time) AT TIME ZONE 'Europe/Sofia'>now()+make_interval(mins=>z.prep_minutes) AND (z.cutoff IS NULL OR s.day>(now() AT TIME ZONE 'Europe/Sofia')::date OR (now() AT TIME ZONE 'Europe/Sofia')::time<z.cutoff) AND NOT EXISTS(SELECT 1 FROM delivery_exceptions e WHERE e.zone_id=z.id AND e.day=s.day AND e.closed) RETURNING s.*`,
          [p.slotId, o.zone_id],
        )
      ).rows[0];
      if (!slot) fail("Изберете свободен интервал в същия район.");
      await c.query(
        "UPDATE delivery_slots SET reserved=reserved-1 WHERE id=$1",
        [o.slot_id],
      );
      await c.query(
        "UPDATE orders SET slot_id=$2,delivery_snapshot=$3,updated_at=now() WHERE id=$1",
        [
          o.id,
          slot.id,
          {
            ...o.delivery_snapshot,
            id: slot.id,
            day: slot.day,
            start_time: slot.start_time,
            end_time: slot.end_time,
          },
        ],
      );
      await event(c, o.id, actor.id, "move", { from: o.slot_id, to: slot.id });
    } else if (action === "item") {
      await editItem(c, o, p, actor, site);
    } else if (action === "contact") {
      if (!["preparing", "waiting"].includes(o.status) || !uuid(p.itemId))
        fail("Невалиден опит за контакт.");
      const item = (
        await c.query(
          "SELECT change_detail FROM order_items WHERE order_id=$1 AND id=$2 FOR UPDATE",
          [o.id, p.itemId],
        )
      ).rows[0];
      if (!item) fail("Няма такъв артикул.");
      const contact = {
        at: new Date().toISOString(),
        channel: text(p.channel) || "телефон",
        reason: reason(p),
        actor: actor.id,
      };
      await c.query("UPDATE order_items SET change_detail=$2 WHERE id=$1", [
        p.itemId,
        {
          ...item.change_detail,
          contacts: [...(item.change_detail.contacts || []), contact],
        },
      ]);
      await event(c, o.id, actor.id, "contact", {
        itemId: p.itemId,
        ...contact,
      });
    } else if (["payment", "refund"].includes(action)) {
      const amount = Number(p.amountCents);
      if (
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        !["cash", "card"].includes(p.method)
      )
        fail("Въведете действителна положителна сума и начин на плащане.");
      const collected = Number(
        (
          await c.query(
            "SELECT coalesce(sum(amount_cents),0) total FROM payments WHERE order_id=$1",
            [o.id],
          )
        ).rows[0].total,
      );
      if (
        action === "payment" &&
        (!["on_route", "delivered", "problem"].includes(o.status) ||
          amount + collected > o.total_cents)
      )
        fail("Сумата надвишава остатъка или доставката още не е започнала.");
      if (action === "refund" && (amount > collected || !text(p.reason)))
        fail("Проверете сумата за възстановяване и причината.");
      const delta = action === "refund" ? -amount : amount;
      const balance = collected + delta;
      const state =
        action === "refund"
          ? balance
            ? "partial_refund"
            : "refunded"
          : balance === o.total_cents
            ? "paid"
            : "partial";
      await c.query(
        "INSERT INTO payments(order_id,amount_cents,method,actor,reason) VALUES($1,$2,$3,$4,$5)",
        [o.id, delta, p.method, actor.id, text(p.reason)],
      );
      await c.query(
        "UPDATE orders SET payment_status=$2,updated_at=now() WHERE id=$1",
        [o.id, state],
      );
      await event(c, o.id, actor.id, action, {
        amountCents: delta,
        method: p.method,
        reason: text(p.reason),
      });
    } else if (action === "resolveClaim") {
      if (
        !uuid(p.claimId) ||
        !["accepted", "rejected", "resolved"].includes(p.status)
      )
        fail("Проверете статуса на рекламацията.");
      const changed = await c.query(
        "UPDATE claims SET status=$3 WHERE id=$1 AND order_id=$2",
        [p.claimId, o.id, p.status],
      );
      if (!changed.rowCount) fail("Записът не е намерен.");
      await event(c, o.id, actor.id, "claim-status", {
        claimId: p.claimId,
        status: p.status,
        reason: reason(p),
      });
    } else fail("Непознато действие.");
    return { ok: true };
  });
}
async function withToken(token: string, c: PoolClient, lock = false) {
  if (!/^[\w-]{40,80}$/.test(token))
    throw new ShopError("Липсва поръчка.", 404);
  const row = (
    await c.query(
      "SELECT * FROM orders WHERE token_hash=$1" + (lock ? " FOR UPDATE" : ""),
      [digest(token)],
    )
  ).rows[0];
  if (!row) throw new ShopError("Липсва поръчка.", 404);
  return row;
}
export async function tracking(token: string) {
  return tx(async (c) => {
    const o = await withToken(token, c);
    const order = {
      number: o.number,
      test_only: o.test_only === true,
      status: o.status,
      payment_status: o.payment_status,
      payment_method: o.payment_method,
      delivery_snapshot: o.delivery_snapshot,
      subtotal_cents: o.subtotal_cents,
      delivery_cents: o.delivery_cents,
      extra_cents: o.extra_cents,
      total_cents: o.total_cents,
      original_cents: o.original_cents,
      created_at: o.created_at,
    };
    const items = (
      await c.query(
        "SELECT id,snapshot,quantity,prepared_quantity,original_cents,line_cents,status,change_detail->'prepared' prepared FROM order_items WHERE order_id=$1 ORDER BY id",
        [o.id],
      )
    ).rows;
    const events = (
      await c.query(
        "SELECT kind,created_at FROM order_events WHERE order_id=$1 ORDER BY id",
        [o.id],
      )
    ).rows;
    const claims = (
      await c.query(
        "SELECT id,kind,status,created_at,item_details FROM claims WHERE order_id=$1 ORDER BY created_at",
        [o.id],
      )
    ).rows;
    return { order, items, events, claims };
  });
}
export async function guestAction(token: string, p: any) {
  return tx(async (c) => {
    const o = await withToken(token, c, true);
    if (p.action === "cancel") {
      if (!["new", "confirmed", "cancelled"].includes(o.status))
        fail("Подготовката е започнала. Свържете се с магазина.");
      await cancelOrder(
        c,
        o,
        "guest",
        text(p.reason) || "Отменена от клиента преди подготовка.",
      );
      return { ok: true };
    }
    if (!["withdraw", "claim"].includes(p.action)) fail("Непознато действие.");
    if (o.status !== "delivered") fail("Действието е за доставени поръчки.");
    const ids = p.itemIds ?? [];
    if (!Array.isArray(ids) || ids.some((v) => !uuid(v)))
      fail("Проверете избраните артикули.");
    const rows = (
      await c.query(
        "SELECT id,snapshot,change_detail FROM order_items WHERE order_id=$1 AND status<>'missing'",
        [o.id],
      )
    ).rows;
    const selected = ids.length ? rows.filter((i) => ids.includes(i.id)) : rows;
    if (
      !selected.length ||
      (ids.length && selected.length !== new Set(ids).size)
    )
      fail("Изберете артикул от доставката.");
    if (p.action === "withdraw") {
      if (!p.confirm || !text(p.name) || !z.email().safeParse(p.email).success)
        fail("Потвърдете отказа и въведете име и имейл за отговор.");
      const eligible = (
        await c.query(
          "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date <= (created_at AT TIME ZONE 'Europe/Sofia')::date+14 ok FROM order_events WHERE order_id=$1 AND kind='delivered' ORDER BY id DESC LIMIT 1",
          [o.id],
        )
      ).rows[0]?.ok;
      if (!eligible)
        fail(
          "Обичайният срок за онлайн отказ е изтекъл. Свържете се с магазина за преглед.",
        );
      if (
        selected.some(
          (i) =>
            (i.change_detail?.prepared?.food || i.snapshot.food)?.withdrawal ===
            "perishable",
        )
      )
        fail("Изберете артикулите с приложимо право на отказ.");
    } else if (!text(p.reason)) fail("Опишете причината за рекламацията.");
    const claim = (
      await c.query(
        "INSERT INTO claims(order_id,kind,item_ids,reason,contact,item_details) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at",
        [
          o.id,
          p.action,
          selected.map((i) => i.id),
          text(p.reason),
          { name: text(p.name), email: text(p.email) },
          JSON.stringify(selected.map(claimLine)),
        ],
      )
    ).rows[0];
    await event(c, o.id, "guest", p.action, { claimId: claim.id });
    if (p.action === "withdraw" || o.customer.email)
      await enqueue(c, o.id, p.action, "email", { claimId: claim.id });
    return { ok: true, id: claim.id, created_at: claim.created_at };
  });
}
