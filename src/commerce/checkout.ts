import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, tx } from "@/db";
import { amountFor, basketAmounts } from "./bundles";
export { amountFor } from "./bundles";
import { today, effectivePrice, offerJoin, siteDefaults } from "./catalog";

export class ShopError extends Error {
  constructor(
    message: string,
    public status = 400,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
const id = z.uuid();
const itemSchema = z.object({
  variantId: id,
  quantity: z.number().positive().max(10000),
  substitution: z.enum(["skip", "call"]).default("skip"),
  note: z.string().trim().max(400).default(""),
  weightTolerance: z.number().min(0).max(100).default(0),
});
export const cartSchema = z.object({
  zoneId: id,
  slotId: id,
  items: z.array(itemSchema).min(1).max(100),
  payment: z.enum(["cash", "card"]).default("cash"),
});
export const orderSchema = cartSchema.extend({
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d ()-]{7,22}$/)
      .refine((p) => p.replace(/\D/g, "").length >= 7),
    street: z.string().trim().min(3).max(250),
    email: z.union([z.email().max(254), z.literal("")]).optional(),
    entrance: z.string().max(30).optional(),
    floor: z.string().max(20).optional(),
    apartment: z.string().max(30).optional(),
    directions: z.string().max(500).optional(),
    note: z.string().max(1000).optional(),
  }),
  quoteSignature: z.string().min(16).max(150),
  idempotencyKey: id,
  termsVersion: z.number().int().nonnegative(),
});
export type CartInput = z.infer<typeof cartSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export function digest(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
function sign(kind: string, value: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw Error("Настройте защитения ключ на магазина.");
  return createHmac("sha256", secret)
    .update(kind + "\0" + value)
    .digest("base64url");
}
export function tokenFor(id: string) {
  return sign("order-tracking", id);
}
export async function generateSlots(c: PoolClient, zoneId?: string) {
  await c.query(
    `WITH rules AS MATERIALIZED (
       SELECT r.* FROM delivery_rules r JOIN delivery_zones z ON z.id=r.zone_id
       WHERE z.active AND r.capacity>0 AND ($1::uuid IS NULL OR z.id=$1)
       ORDER BY r.id FOR SHARE OF r
     )
     INSERT INTO delivery_slots(zone_id,day,start_time,end_time,capacity)
     SELECT r.zone_id,d::date,r.start_time,r.end_time,r.capacity FROM rules r
     CROSS JOIN generate_series((now() AT TIME ZONE 'Europe/Sofia')::date,
       (now() AT TIME ZONE 'Europe/Sofia')::date+20,'1 day') d
     WHERE extract(isodow FROM d)=r.weekday ON CONFLICT DO NOTHING`,
    [zoneId || null],
  );
}
const openSlot = `z.active AND s.active AND s.reserved<s.capacity AND (s.day+s.start_time) AT TIME ZONE 'Europe/Sofia'>now()+make_interval(mins=>z.prep_minutes) AND (z.cutoff IS NULL OR s.day>(now() AT TIME ZONE 'Europe/Sofia')::date OR (now() AT TIME ZONE 'Europe/Sofia')::time<z.cutoff) AND NOT EXISTS(SELECT 1 FROM delivery_exceptions e WHERE e.zone_id=z.id AND e.day=s.day AND e.closed)`;
export async function delivery(zoneId?: string | null) {
  const zones = await query(
    "SELECT id,name,min_cents,fee_cents,free_cents FROM delivery_zones WHERE active ORDER BY name",
  );
  if (!zoneId || !id.safeParse(zoneId).success) return { zones, slots: [] };
  return {
    zones,
    slots: await tx(async (c) => {
      await generateSlots(c, zoneId);
      return (
        await c.query(
          `SELECT s.id,s.zone_id,s.day,s.start_time,s.end_time,s.capacity-s.reserved AS remaining FROM delivery_slots s JOIN delivery_zones z ON s.zone_id=z.id WHERE s.zone_id=$1 AND ${openSlot} ORDER BY s.day,s.start_time LIMIT 150`,
          [zoneId],
        )
      ).rows;
    }),
  };
}
function ensureOpen(site: any, version: number) {
  if (!site.ordersOpen)
    throw new ShopError("В момента магазинът не приема нови поръчки.", 409);
  if (
    !version ||
    (!site.demo &&
      (!site.company ||
        !site.companyId ||
        !site.address ||
        !site.phone ||
        !site.registeredFood ||
        !site.transportReady ||
        !site.fiscalReady ||
        !site.brandReady ||
        !site.legalReady))
  )
    throw new ShopError("Магазинът подготвя приемането на поръчки.", 409);
}
export async function priceBasket(
  c: PoolClient,
  input: CartInput,
  lock = false,
) {
  const site = {
    ...siteDefaults,
    ...(
      await c.query(
        "SELECT value FROM settings WHERE key='site'" +
          (lock ? " FOR SHARE" : ""),
      )
    ).rows[0]?.value,
  };
  const terms = (
    await c.query(
      "SELECT version,published FROM pages WHERE slug='obshti-usloviya' AND published IS NOT NULL" +
        (lock ? " FOR SHARE" : ""),
    )
  ).rows[0];
  ensureOpen(site, terms?.version);
  const slot = (
    await c.query(
      `SELECT s.id,s.day,s.start_time,s.end_time,s.zone_id,z.name,z.min_cents,z.fee_cents,z.free_cents FROM delivery_slots s JOIN delivery_zones z ON s.zone_id=z.id WHERE s.id=$1 AND z.id=$2 AND ${openSlot} ${lock ? "FOR UPDATE OF s FOR SHARE OF z" : ""}`,
      [input.slotId, input.zoneId],
    )
  ).rows[0];
  if (!slot)
    throw new ShopError(
      "Интервалът е запълнен или вече е затворен. Изберете друг.",
      409,
    );
  if (input.payment === "card" && !site.cardEnabled)
    throw new ShopError("Плащането с карта при доставка не е достъпно.", 409);
  const ids = input.items.map((i) => i.variantId);
  if (new Set(ids).size !== ids.length)
    throw new ShopError("Обединете количествата на еднаквите варианти.");
  const day = site.promoBasis === "order" ? today() : slot.day;
  const data = (
    await c.query(
      `SELECT v.*,p.name product_name,p.slug,p.brand,(p.food||v.food) food,p.origin,p.available local_available,cat.name category_name,active.offer FROM variants v JOIN products p ON p.id=v.product_id JOIN categories cat ON cat.id=p.category_id ${offerJoin} WHERE v.id=ANY($2::uuid[]) AND p.status='published' ORDER BY v.id ${lock ? "FOR SHARE OF v,p" : ""}`,
      [day, ids],
    )
  ).rows;
  const items = input.items.map((i) => {
    const v = data.find((v) => v.id === i.variantId);
    if (
      !v ||
      !v.available ||
      !v.local_available ||
      (v.food.ageRestricted && !site.ageEnabled)
    )
      throw new ShopError(
        "Артикул от количката е недостъпен. Обновете количката.",
        409,
      );
    if (
      (v.unit === "piece" && !Number.isInteger(i.quantity)) ||
      Math.abs(i.quantity * 1000 - Math.round(i.quantity * 1000)) > 0.000001 ||
      (v.online_limit != null && i.quantity > Number(v.online_limit))
    )
      throw new ShopError(
        "Проверете количеството за „" + v.product_name + "“.",
        409,
      );
    if (
      i.weightTolerance > Number(site.weightTolerance) ||
      (v.unit !== "kg" && i.weightTolerance > 0)
    )
      throw new ShopError("Проверете разрешеното отклонение за теглото.", 409);
    const { price_cents: unitCents, offer } = effectivePrice(v, day);
    if (unitCents === null)
      throw new ShopError(
        "За „" + v.product_name + "“ няма потвърдена цена за избрания ден.",
        409,
      );
    const regular =
      v.local_cents != null && (!v.local_until || v.local_until >= day)
        ? v.local_cents
        : v.regular_cents;
    const lineCents = amountFor(unitCents, i.quantity, offer, regular);
    return {
      ...i,
      productId: v.product_id,
      productName: v.product_name,
      categoryName: v.category_name,
      variantName: v.name,
      pack: v.pack,
      unit: v.unit,
      unitCents,
      lineCents,
      offer,
      regularCents: regular,
      terms: offer?.terms || "",
      food: v.food,
      brand: v.brand,
      slug: v.slug,
    };
  });
  const allocations = basketAmounts(items);
  items.forEach((line, index) => {
    line.lineCents = allocations[index];
  });
  const subtotal = items.reduce((n, i) => n + i.lineCents, 0);
  if (subtotal < slot.min_cents)
    throw new ShopError(
      "Минималната стойност за района е " +
        (slot.min_cents / 100).toFixed(2) +
        " €.",
      409,
    );
  const fee =
    slot.free_cents != null && subtotal >= slot.free_cents ? 0 : slot.fee_cents;
  const extra = Number(site.extraFeeCents || 0);
  const total = subtotal + fee + extra;
  if (!Number.isSafeInteger(total) || total > 2147483647)
    throw new ShopError(
      "Сумата надвишава поддържания размер на онлайн поръчка.",
    );
  const value = {
    items,
    subtotal,
    delivery: fee,
    extra,
    total,
    termsVersion: terms.version,
    slot,
    day,
    payment: input.payment,
  };
  const seller = Object.fromEntries(
    ["name", "company", "companyId", "address", "city", "phone", "email"].map(
      (key) => [key, site[key] || ""],
    ),
  );
  return {
    ...value,
    signature: sign("price", JSON.stringify({ ...value, seller })),
    termsContent: { ...terms.published, seller },
  };
}
export async function quote(input: CartInput) {
  const { termsContent, ...q } = await tx((c) => priceBasket(c, input));
  return q;
}
export async function submit(input: OrderInput) {
  const fingerprint = digest(JSON.stringify(input));
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      input.idempotencyKey,
    ]);
    const old = (
      await c.query(
        "SELECT id,number,request_hash FROM orders WHERE idempotency_key=$1",
        [input.idempotencyKey],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== fingerprint)
        throw new ShopError(
          "Ключът за поръчка вече е използван с други данни.",
          409,
        );
      return { number: String(old.number), token: tokenFor(old.id) };
    }
    const q = await priceBasket(c, input, true);
    const a = Buffer.from(input.quoteSignature),
      b = Buffer.from(q.signature);
    if (
      input.termsVersion !== q.termsVersion ||
      a.length !== b.length ||
      !timingSafeEqual(a, b)
    ) {
      const { termsContent, ...publicQuote } = q;
      throw new ShopError(
        "Условията са променени. Прегледайте новата сума и потвърдете.",
        409,
        { quote: publicQuote },
      );
    }
    const uuid = (await c.query("SELECT gen_random_uuid() AS id")).rows[0].id;
    const token = tokenFor(uuid);
    const row = (
      await c.query(
        `INSERT INTO orders(id,idempotency_key,request_hash,token_hash,customer,zone_id,slot_id,delivery_snapshot,payment_method,subtotal_cents,delivery_cents,extra_cents,original_cents,total_cents,terms_version,terms_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15) RETURNING number`,
        [
          uuid,
          input.idempotencyKey,
          fingerprint,
          digest(token),
          input.customer,
          input.zoneId,
          input.slotId,
          q.slot,
          input.payment,
          q.subtotal,
          q.delivery,
          q.extra,
          q.total,
          q.termsVersion,
          q.termsContent,
        ],
      )
    ).rows[0];
    await c.query("UPDATE delivery_slots SET reserved=reserved+1 WHERE id=$1", [
      input.slotId,
    ]);
    for (const i of q.items)
      await c.query(
        `INSERT INTO order_items(order_id,variant_id,snapshot,quantity,unit_cents,original_cents,line_cents,substitution,note,weight_tolerance) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
        [
          uuid,
          i.variantId,
          i,
          i.quantity,
          i.unitCents,
          i.lineCents,
          i.substitution,
          i.note,
          i.weightTolerance,
        ],
      );
    await c.query("INSERT INTO order_events(order_id,kind) VALUES($1,'new')", [
      uuid,
    ]);
    if (input.customer.email)
      await enqueue(c, uuid, "received", "email", { slot: q.slot });
    await enqueue(c, uuid, "received", "print", { slot: q.slot });
    const notify =
      (await c.query("SELECT value FROM settings WHERE key='site'")).rows[0]
        ?.value || {};
    if (notify.notificationEmail && notify.email)
      await enqueue(c, uuid, "staff_received", "email", {
        recipient: notify.email,
      });
    if (notify.notificationSms && process.env.SMS_TWILIO_ACCOUNT_SID)
      await enqueue(c, uuid, "received", "sms", {});
    return { number: String(row.number), token };
  });
}
export async function enqueue(
  c: PoolClient,
  orderId: string,
  kind: string,
  channel: string,
  payload: any,
) {
  await c.query(
    "INSERT INTO notification_jobs(order_id,kind,channel,payload) VALUES($1,$2,$3,$4)",
    [orderId, kind, channel, payload],
  );
}
