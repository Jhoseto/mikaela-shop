import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { Client } from "pg";
import { spawnSync } from "node:child_process";

test("PostgreSQL: цени, последно място, идемпотентност, подготовка, отказ, роли и известия", async (t) => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw Error("Изисква се локален PostgreSQL.");
  const label = "mikaela_test_" + randomUUID().replaceAll("-", "");
  url.pathname = "/postgres";
  const admin = new Client({ connectionString: url.href });
  await admin.connect();
  await admin.query('CREATE DATABASE "' + label + '"');
  url.pathname = "/" + label;
  process.env.DATABASE_URL = url.href;
  process.env.NOTIFICATION_MODE = "test";
  const migration = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/migrate.ts"],
    { env: process.env, encoding: "utf8", windowsHide: true },
  );
  assert.equal(migration.status, 0, migration.stderr);
  const { pool, query, tx } = await import("../src/db");
  const { quote, submit, amountFor, delivery } =
    await import("../src/commerce/checkout");
  const { manage } = await import("../src/admin/management-commands");
  const { changeOrder, tracking, guestAction } =
    await import("../src/commerce/orders");
  const { sendNotifications } = await import("../src/commerce/notifications");
  const { getCatalog } = await import("../src/commerce/catalog");
  const owner = { id: "qa-staff", roles: ["staff"] },
    courier = { id: "qa-courier", roles: ["courier"] };
  const evidence: string[] = [];
  try {
    await query("UPDATE settings SET value=$1 WHERE key='site'", [
      {
        demo: true,
        ordersOpen: true,
        contactAttempts: 1,
        contactWaitMinutes: 0,
      },
    ]);
    await query(
      "INSERT INTO pages(slug,published,version) VALUES('obshti-usloviya',$1,1)",
      [{ title: "Учебни условия", body: "Тестова поръчка." }],
    );
    await query("INSERT INTO staff_roles VALUES ('qa-courier','courier')");
    const [category] = await query(
      "INSERT INTO categories(slug,name) VALUES('test','Учебни') RETURNING id",
    );
    async function variant(name: string, unit: string, price: number) {
      const [p] = await query(
        "INSERT INTO products(slug,name,status,category_id,food) VALUES($1,$2,'published',$3,$4) RETURNING id",
        [
          randomUUID(),
          name,
          category.id,
          { type: "nonfood", withdrawal: "eligible" },
        ],
      );
      return (
        await query(
          "INSERT INTO variants(product_id,name,pack,unit,regular_cents) VALUES($1,$2,'Тест',$3,$4) RETURNING id",
          [p.id, name, unit, price],
        )
      )[0].id as string;
    }
    const chocolate = await variant("Тестови бройки", "piece", 400),
      weight = await variant("Тестово тегло", "kg", 499),
      replacement = await variant("Тестова замяна", "piece", 350);
    const [zone] = await query(
      "INSERT INTO delivery_zones(name,fee_cents,free_cents) VALUES('Учебен район',200,1100) RETURNING id",
    );
    function slot(n: number) {
      return query(
        "INSERT INTO delivery_slots(zone_id,day,start_time,end_time,capacity) VALUES($1,(now() at time zone 'Europe/Sofia')::date+$2::int,'12:00','14:00',1) RETURNING *",
        [zone.id, n],
      ).then((r) => r[0]);
    }
    const s1 = await slot(1),
      s2 = await slot(2),
      s3 = await slot(3);
    await query(
      "INSERT INTO offers(variant_id,starts,ends,price_cents,buy,pay,terms,approved) VALUES($1,$2,$2,300,2,1,'Две за една',true)",
      [chocolate, s1.day],
    );
    await query(
      "INSERT INTO synonyms VALUES('шоколад',ARRAY['Тестови бройки'])",
    );
    assert.equal(
      (await getCatalog({ q: "шоколад" }))[0].name,
      "Тестови бройки",
    );
    assert.ok((await getCatalog({ q: "бройки" })).length);
    assert.equal(
      (await getCatalog({ q: "ТЕСТТОВИ БРОЙКИ" }))[0]?.name,
      "Тестови бройки",
      "Кирилица с главни букви и печатна грешка",
    );
    assert.equal(amountFor(300, 3, { buy: 2, pay: 1 }, 400), 700);
    assert.equal(amountFor(499, 0.333), 166);
    const cart = {
      zoneId: zone.id,
      slotId: s1.id,
      items: [
        {
          variantId: chocolate,
          quantity: 3,
          substitution: "call" as const,
          note: "",
          weightTolerance: 0,
        },
        {
          variantId: weight,
          quantity: 1,
          substitution: "skip" as const,
          note: "",
          weightTolerance: 0,
        },
      ],
      payment: "cash" as const,
    };
    const q = await quote(cart);
    assert.equal(q.subtotal, 1199);
    assert.equal(q.total, 1199);
    const next = await quote({ ...cart, slotId: s2.id });
    assert.equal(next.subtotal, 1699);
    const make = (key: string, signature = q.signature) => ({
      ...cart,
      customer: {
        name: "Учебен клиент",
        phone: "0000000000",
        email: "test@example.invalid",
        street: "Учебен адрес",
      },
      quoteSignature: signature,
      termsVersion: 1,
      idempotencyKey: key,
    });
    const bundleId = randomUUID();
    for (const variantId of [chocolate, replacement])
      await query(
        "INSERT INTO offers(variant_id,starts,ends,buy,pay,terms,approved,group_id,max_groups) VALUES($1,$2,$2,2,1,'Смесен пакет',true,$3,1)",
        [variantId, s2.day, bundleId],
      );
    const mixed = await quote({
      ...cart,
      slotId: s2.id,
      items: [
        { ...cart.items[0], quantity: 2 },
        { ...cart.items[0], variantId: replacement, quantity: 2 },
      ],
    });
    assert.equal(mixed.subtotal, 1150);
    assert.equal(
      mixed.items.find((i) => i.variantId === replacement)?.lineCents,
      350,
    );
    const double = make(randomUUID()),
      other = make(randomUUID());
    await assert.rejects(
      submit({ ...double, quoteSignature: "different-price-signature" }),
      /променени/i,
    );
    const results = await Promise.allSettled([submit(double), submit(other)]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    const winner = results[0].status === "fulfilled" ? double : other;
    const first = await submit(winner);
    const repeats = await Promise.all([submit(winner), submit(winner)]);
    assert.deepEqual(repeats, [first, first]);
    assert.equal((await query("SELECT count(*)::int n FROM orders"))[0].n, 1);
    assert.equal(
      (
        await query("SELECT reserved FROM delivery_slots WHERE id=$1", [s1.id])
      )[0].reserved,
      1,
    );
    evidence.push(
      "Пакет, тегло, ден за доставка, промяна на цена, конкуренция, повторно изпращане.",
    );
    const o = (await query("SELECT * FROM orders"))[0];
    const lines = await query("SELECT * FROM order_items WHERE order_id=$1", [
      o.id,
    ]);
    const pieces = lines.find((x) => x.variant_id === chocolate),
      kg = lines.find((x) => x.variant_id === weight);
    await assert.rejects(tracking(String(o.number)), /Липсва/);
    await assert.rejects(changeOrder(o.id, "deliver", {}, courier), /достъп/);
    await assert.rejects(changeOrder(o.id, "prepare", {}, owner), /достъпно/);
    await changeOrder(o.id, "move", { slotId: s2.id }, owner);
    assert.equal(
      (
        await query("SELECT reserved FROM delivery_slots WHERE id=$1", [s1.id])
      )[0].reserved,
      0,
    );
    await changeOrder(o.id, "confirm", {}, owner);
    await changeOrder(o.id, "prepare", {}, owner);
    await assert.rejects(
      changeOrder(
        o.id,
        "item",
        { itemId: kg.id, status: "prepared", quantity: 1.02 },
        owner,
      ),
      /съгласие/,
    );
    const [replacementProduct] = await query(
      "SELECT p.id,p.slug FROM products p JOIN variants v ON v.product_id=p.id WHERE v.id=$1",
      [replacement],
    );
    const [replacementCategory] = await query(
      "INSERT INTO categories(slug,name) VALUES('replacement','Подготвени алтернативи') RETURNING id",
    );
    await query(
      "UPDATE products SET brand='Марка на замяната',category_id=$2 WHERE id=$1",
      [replacementProduct.id, replacementCategory.id],
    );
    const approveReplacement = (itemId: string, quantity = 1) => changeOrder(
      o.id,
      "item",
      { itemId, status: "replaced", quantity, variantId: replacement,
        approval: { by: "Клиентът", channel: "телефон" } },
      owner,
    );
    await assert.rejects(approveReplacement(kg.id), /избрал пропускане/);
    await query("UPDATE products SET food=food||'{\"ageRestricted\":true}'::jsonb WHERE id=$1", [replacementProduct.id]);
    await assert.rejects(approveReplacement(pieces.id), /недостъпен/);
    await query("UPDATE products SET food=food-'ageRestricted',status='hidden' WHERE id=$1", [replacementProduct.id]);
    await assert.rejects(approveReplacement(pieces.id), /недостъпен/);
    await query("UPDATE products SET status='published' WHERE id=$1", [replacementProduct.id]);
    await query("UPDATE variants SET online_limit=1 WHERE id=$1", [replacement]);
    await assert.rejects(approveReplacement(pieces.id, 2), /лимита/);
    await tx((c) => manage(c, "settings.pause", {}));
    await assert.rejects(quote({ ...cart, slotId: s3.id }), /не приема/);
    await query(
      "UPDATE settings SET value=value||$1::jsonb WHERE key='site'",
      [JSON.stringify({ ageEnabled: true })],
    );
    await query(
      "UPDATE products SET food=food||$1::jsonb WHERE id=$2",
      [JSON.stringify({ ageRestricted: true }), replacementProduct.id],
    );
    await changeOrder(
      o.id,
      "item",
      { itemId: kg.id, status: "prepared", quantity: 0.805 },
      owner,
    );
    await assert.rejects(
      changeOrder(
        o.id,
        "item",
        { itemId: pieces.id, status: "missing" },
        owner,
      ),
      /решение/,
    );
    await changeOrder(
      o.id,
      "contact",
      { itemId: pieces.id, channel: "телефон", reason: "Няма отговор." },
      owner,
    );
    await changeOrder(o.id, "wait", { reason: "Съгласуване" }, owner);
    await changeOrder(o.id, "resume", {}, owner);
    await assert.rejects(
      changeOrder(
        o.id,
        "item",
        {
          itemId: pieces.id,
          status: "replaced",
          quantity: 1,
          variantId: replacement,
        },
        owner,
      ),
      /съгласие/,
    );
    await changeOrder(
      o.id,
      "item",
      {
        itemId: pieces.id,
        status: "replaced",
        quantity: 1,
        variantId: replacement,
        approval: { by: "Клиентът", channel: "телефон" },
      },
      owner,
    );
    await changeOrder(o.id, "ready", {}, owner);
    const [substitutionRecord] = await query(
      "SELECT snapshot,change_detail->'prepared' AS item FROM order_items WHERE id=$1",
      [pieces.id],
    );
    assert.equal(substitutionRecord.snapshot.productName, "Тестови бройки");
    assert.equal(substitutionRecord.snapshot.terms, "Две за една");
    const prepared = substitutionRecord.item;
    assert.equal(prepared.productId, replacementProduct.id);
    assert.equal(prepared.slug, replacementProduct.slug);
    assert.equal(prepared.categoryName, "Подготвени алтернативи");
    assert.equal(prepared.brand, "Марка на замяната");
    assert.equal(prepared.variantId, replacement);
    assert.equal(prepared.terms, prepared.offer.terms);
    assert.match(prepared.terms, /Смесен пакет/);
    await changeOrder(o.id, "assign", { courierId: courier.id }, owner);
    await changeOrder(o.id, "dispatch", {}, owner);
    await changeOrder(
      o.id,
      "problem",
      { reason: "Уточняване на адрес" },
      courier,
    );
    await changeOrder(o.id, "resume", {}, owner);
    await assert.rejects(changeOrder(o.id, "deliver", {}, courier), /възрастта/);
    await changeOrder(o.id, "deliver", { ageChecked: true }, courier);
    const delivered = await tracking(first.token);
    assert.equal(delivered.order.payment_status, "pending");
    assert.equal(delivered.order.delivery_cents, 0);
    assert.equal(delivered.order.original_cents, 1199);
    assert.equal(delivered.order.total_cents, 752);
    await changeOrder(
      o.id,
      "payment",
      { amountCents: 752, method: "cash" },
      courier,
    );
    assert.equal((await tracking(first.token)).order.payment_status, "paid");
    await changeOrder(
      o.id,
      "refund",
      { amountCents: 50, method: "cash", reason: "Учебна корекция" },
      owner,
    );
    const claim = await guestAction(first.token, {
      action: "claim",
      reason: "Учебна рекламация",
      itemIds: [pieces.id],
    });
    assert.ok(claim.id);
    const [claimRecord] = await query("SELECT item_details FROM claims WHERE id=$1", [claim.id]);
    assert.deepEqual(claimRecord.item_details, [{
      id: pieces.id, variantId: replacement, productName: "Тестова замяна",
      variantName: "Тестова замяна", pack: "Тест",
    }]);
    await changeOrder(
      o.id,
      "resolveClaim",
      { claimId: claim.id, status: "resolved", reason: "Проверена" },
      owner,
    );
    await guestAction(first.token, {
      action: "withdraw",
      name: "Учебен клиент",
      email: "test@example.invalid",
      confirm: true,
      itemIds: [pieces.id],
    });
    await assert.rejects(
      guestAction(first.token, { action: "cancel" }),
      /Подготовката/,
    );
    evidence.push(
      "Чужд куриер, достъп с токен, преместване, липса, одобрена замяна, действително тегло, доставка, плащане, рекламация, отказ.",
    );
    const cart2 = {
      ...cart,
      slotId: s3.id,
      items: [{ ...cart.items[0], quantity: 1 }],
    };
    await query(
      "UPDATE settings SET value=value||$1::jsonb WHERE key='site'",
      [JSON.stringify({ ordersOpen: true })],
    );
    const price2 = await quote(cart2);
    const second = await submit({
      ...make(randomUUID(), price2.signature),
      ...cart2,
    });
    const [b] = await query("SELECT id FROM orders WHERE number=$1", [
      second.number,
    ]);
    await changeOrder(b.id, "confirm", {}, owner);
    await changeOrder(b.id, "prepare", {}, owner);
    const [bi] = await query("SELECT id FROM order_items WHERE order_id=$1", [
      b.id,
    ]);
    await changeOrder(
      b.id,
      "contact",
      { itemId: bi.id, channel: "телефон", reason: "Без отговор" },
      owner,
    );
    await changeOrder(
      b.id,
      "item",
      { itemId: bi.id, status: "missing", reason: "Изчерпан" },
      owner,
    );
    await changeOrder(b.id, "cancel", { reason: "Повторение" }, owner);
    assert.equal(
      (
        await query("SELECT reserved FROM delivery_slots WHERE id=$1", [s3.id])
      )[0].reserved,
      0,
    );
    process.env.NOTIFICATION_MODE = "live";
    delete process.env.SMTP_URL;
    await sendNotifications(50);
    assert.ok(
      (await query("SELECT 1 FROM notification_jobs WHERE status='retry'"))
        .length,
    );
    assert.equal((await query("SELECT count(*)::int n FROM orders"))[0].n, 2);
    process.env.NOTIFICATION_MODE = "test";
    await query(
      "UPDATE notification_jobs SET next_at=now() WHERE status='retry'",
    );
    await sendNotifications(50);
    const documents = await query(
      "SELECT kind,payload->>'document' AS text FROM notification_jobs WHERE order_id=$1 AND channel='email' AND status='test_captured'",
      [o.id],
    );
    const document = (kind: string) => documents.find((d) => d.kind === kind)?.text || "";
    assert.match(document("received"), /Две за една/);
    assert.match(document("delivered"), /Смесен пакет/);
    assert.doesNotMatch(document("delivered"), /Две за една/);
    for (const kind of ["claim", "withdraw"]) {
      assert.match(document(kind), /Тестова замяна · Тест/);
      assert.doesNotMatch(document(kind), /Тестови бройки/);
    }
    evidence.push(
      "Съгласие за замяна, проверка на възрастта, количество, публикация, изпълнение при пауза и действителен артикул в имейла, отказа и рекламацията.",
    );
    assert.ok(
      (
        await query(
          "SELECT 1 FROM notification_jobs WHERE status='test_captured' AND kind='withdraw' AND payload ? 'document'",
        )
      ).length,
    );
    evidence.push(
      "Последна липса анулира, мястото се освобождава веднъж, неуспешен имейл и успешно повторение в тестов режим.",
    );
    const revised = await slot(4);
    const [ruleDay] = await query(
      "SELECT extract(isodow FROM day)::int AS n FROM delivery_slots WHERE id=$1",
      [revised.id],
    );
    const setCapacity = (size: number) =>
      tx((c) =>
        manage(c, "delivery.rule", {
          zone: zone.id,
          weekday: String(ruleDay.n),
          start: "12:00",
          end: "14:00",
          capacity: String(size),
        }),
      );
    await setCapacity(3);
    const limitedCart = { ...cart2, slotId: revised.id };
    const seen = await quote(limitedCart);
    const book = () =>
      submit({ ...make(randomUUID(), seen.signature), ...limitedCart });
    const reservations = [await book(), await book(), await book()];
    await setCapacity(1);
    for (let i = 0; i < 3; i++) {
      const [slotState] = await query(
        "SELECT reserved,capacity FROM delivery_slots WHERE id=$1", [revised.id],
      );
      assert.deepEqual(slotState, { reserved: 3 - i, capacity: 1 });
      const available = (await delivery(zone.id)).slots;
      assert.equal(available.some((s) => s.id === revised.id), false);
      await assert.rejects(book(), /интервал за доставка вече не е свободен/i);
      await assert.rejects(
        query("UPDATE delivery_slots SET reserved=reserved+1 WHERE id=$1", [revised.id]),
        { code: "23514" },
      );
      await guestAction(reservations[i].token, { action: "cancel" });
    }
    const reopened = (await delivery(zone.id)).slots.find((s) => s.id === revised.id);
    assert.equal(reopened?.remaining, 1);
    await book();
    await assert.rejects(book(), /интервал за доставка вече не е свободен/i);
    evidence.push(
      "Намаляване на лимита от 3 на 1 запазва приетите поръчки и отваря единствено наистина свободно място.",
    );
    await fs.mkdir("var/qa", { recursive: true });
    await fs.writeFile(
      "var/qa/commerce.json",
      JSON.stringify({ passed: true, date: new Date(), evidence }, null, 2),
    );
  } finally {
    await pool.end();
    await admin.query('DROP DATABASE "' + label + '"');
    await admin.end();
  }
});
