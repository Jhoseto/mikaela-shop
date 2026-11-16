import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db";
import { productCommand } from "../src/admin/product-commands";
import { manage } from "../src/admin/management-commands";
import type { Values } from "../src/admin/input";

const target = new URL(process.env.DATABASE_URL || "");
assert.ok(
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
    target.pathname === "/mikaela_demo",
);
const c = await pool.connect();
const tag = randomUUID().slice(0, 10);
try {
  await c.query("begin");
  const category = (
    await c.query(
      "insert into categories(slug,name) values($1,$2) returning id",
      ["admin-qa-" + tag, "Категория за проверка"],
    )
  ).rows[0].id;
  const form: Values = {
    name: "Проверка " + tag,
    category,
    foodType: "nonfood",
    variantCount: "1",
    v0_name: "Първи вариант",
    v0_pack: "500 г",
    v0_unit: "piece",
    v0_regular: "4,50",
    v0_available: "on",
    v0_mode: "source",
    v0_barcode: tag,
    status: "published",
    available: "on",
    photos: "[]",
  };
  const saved = await productCommand(c, "product.save", form);
  const id = saved.href!.split("/").pop();
  const [v] = (
    await c.query("select * from variants where product_id=$1", [id])
  ).rows;
  assert.equal(v.regular_cents, 450);
  await productCommand(c, "product.quick", {
    id,
    variant: v.id,
    regular: "4,25",
    available: "on",
  });
  const priceLog = (
    await c.query(
      "select changes from price_history where variant_id=$1 order by id",
      [v.id],
    )
  ).rows;
  assert.equal(priceLog.at(-1).changes.regular, 425);
  const duplicated = await productCommand(c, "product.duplicate", { id });
  const duplicateId = duplicated.href!.split("/").pop();
  const copy = (
    await c.query(
      "select p.status,p.origin,v.barcode from products p join variants v on v.product_id=p.id where p.id=$1",
      [duplicateId],
    )
  ).rows[0];
  assert.deepEqual(copy, { status: "draft", origin: "local", barcode: null });
  await productCommand(c, "product.bulk", {
    "ids[]": [duplicateId],
    operation: "archived",
  });
  assert.equal(
    (await c.query("select status from products where id=$1", [duplicateId]))
      .rows[0].status,
    "archived",
  );
  console.log(
    "OK Ръчен продукт, нова цена с история, дубликат без баркод, архивиране",
  );
  const foodForm: Values = {
    ...form,
    name: "Варианти от етикет " + tag,
    foodType: "unpackaged",
    source: "Тестов етикет за двата варианта",
    variantCount: "2",
    v0_barcode: "",
    v0_food_allergens: "Мляко",
    v1_name: "Втори вариант",
    v1_pack: "300 г",
    v1_unit: "piece",
    v1_regular: "5.00",
    v1_available: "on",
    v1_food_allergens: "Соя",
    v1_food_source: "Тестов етикет за втори вариант",
  };
  const foodProduct = (await productCommand(c, "product.save", foodForm))
    .href!.split("/")
    .pop();
  const separate = (
    await c.query(
      "select name,food from variants where product_id=$1 order by regular_cents",
      [foodProduct],
    )
  ).rows;
  assert.deepEqual(
    separate.map((v) => v.food.allergens),
    ["Мляко", "Соя"],
  );
  assert.equal(separate[0].food.source, undefined);
  const same = (
    await productCommand(c, "product.duplicate", { id: foodProduct })
  )
    .href!.split("/")
    .pop();
  assert.deepEqual(
    (
      await c.query(
        "select name,food from variants where product_id=$1 order by regular_cents",
        [same],
      )
    ).rows,
    separate,
  );
  console.log(
    "OK Вариантите наследяват общ източник и пазят индивидуални алергени и етикет при дублиране",
  );

  await c.query("delete from pages where slug=$1", ["home"]);
  let home = {
    slug: "home",
    title: "Тест на банера",
    body: "Първа чернова",
    image: "[]",
    button: "Започни да пазаруваш",
    "featured[]": [id],
    operation: "draft",
  };
  await manage(c, "page.save", home);
  let row = (await c.query("select * from pages where slug='home'")).rows[0];
  assert.equal(row.published, null);
  await manage(c, "page.save", {
    ...home,
    revision: row.updated_at.toISOString(),
    operation: "publish",
  });
  row = (await c.query("select * from pages where slug='home'")).rows[0];
  assert.equal(row.published.body, home.body);
  assert.equal(row.version, 1);
  await manage(c, "page.save", {
    ...home,
    revision: row.updated_at.toISOString(),
    body: "Само в черновата",
    operation: "draft",
  });
  row = (await c.query("select * from pages where slug='home'")).rows[0];
  assert.equal(row.published.body, "Първа чернова");
  assert.equal(row.draft.body, "Само в черновата");
  const settings = (
    await c.query("select value from settings where key='site'")
  ).rows[0].value;
  assert.equal(settings.hero.title, home.title);
  assert.deepEqual(settings.featuredIds, [id]);
  assert.equal(
    (
      await c.query(
        "select content from page_versions where slug='home' and version=1",
      )
    ).rows[0].content.body,
    home.body,
  );
  console.log(
    "OK CMS чернова, публикуване, отделна редакция, история, подбрани артикули",
  );
  await manage(c, "offer.save", {
    variant: v.id,
    start: "2026-11-01",
    end: "2026-11-30",
    price: "",
    buy: "2",
    pay: "1",
    terms: "Вземи 2, плати 1",
    approved: "on",
  });
  const offer = (
    await c.query("select * from offers where variant_id=$1", [v.id])
  ).rows[0];
  assert.deepEqual([offer.buy, offer.pay, offer.approved], [2, 1, true]);
  await assert.rejects(
    () =>
      manage(c, "offer.save", {
        variant: v.id,
        start: "2026-11-20",
        end: "2026-11-25",
        price: "3,75",
        buy: "1",
        pay: "1",
        approved: "on",
      }),
    /друга одобрена/,
  );
  console.log("OK Местна пакетна оферта и проверка за припокриване");
  const members = (
    await c.query(
      "select id from variants where product_id=$1 order by regular_cents",
      [foodProduct],
    )
  ).rows.map((r) => r.id);
  const common = {
    id: offer.id,
    variant: v.id,
    start: "2026-11-01",
    end: "2026-11-30",
    price: "",
    buy: "2",
    pay: "1",
    approved: "on",
    terms: "Вземи 2, плати 1",
  };
  await manage(c, "offer.save", {
    ...common,
    "otherVariants[]": members,
    maxGroups: "3",
  });
  const grouped = (
    await c.query("select * from offers where variant_id=any($1::uuid[])", [
      members,
    ])
  ).rows;
  assert.equal(grouped.length, 2);
  assert.ok(grouped[0].group_id);
  assert.equal(grouped[0].group_id, grouped[1].group_id);
  assert.equal(grouped[0].max_groups, 3);
  await manage(c, "offer.save", {
    ...common,
    "otherVariants[]": [],
    maxGroups: "1",
  });
  const singles = (
    await c.query("select * from offers where id=$1 or group_id=$2", [
      offer.id,
      grouped[0].group_id,
    ])
  ).rows;
  assert.equal(singles.length, 1);
  assert.equal(singles[0].group_id, null);
  assert.equal(singles[0].max_groups, 1);
  console.log(
    "OK Един вариант → смесена оферта с три варианта и лимит → един вариант, без остатъчни оферти.",
  );
  await manage(c, "zone.save", {
    name: "Проверка " + tag,
    active: "on",
    minimum: "12,00",
    fee: "3",
    free: "36",
    prep: "45",
    cutoff: "16:30",
  });
  const zone = (
    await c.query("select * from delivery_zones where name=$1", [
      "Проверка " + tag,
    ])
  ).rows[0];
  assert.equal(zone.fee_cents, 300);
  await manage(c, "delivery.rule", {
    zone: zone.id,
    weekday: "1",
    start: "14:00",
    end: "16:00",
    capacity: "2",
  });
  await manage(c, "delivery.exception", {
    zone: zone.id,
    day: "2026-12-24",
    closed: "on",
  });
  assert.equal(
    (
      await c.query("select closed from delivery_exceptions where zone_id=$1", [
        zone.id,
      ])
    ).rows[0].closed,
    true,
  );
  console.log("OK Район, тарифа, график и празнично изключение");
} finally {
  await c.query("rollback");
  c.release();
  await pool.end();
}
