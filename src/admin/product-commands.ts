import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { publicationIssues } from "@/commerce/catalog";
import { InputIssue } from "./http";
import {
  type Values,
  string,
  uuid,
  on,
  one,
  integer,
  grams,
  price,
  arr,
  media,
  date,
  slugify,
} from "./input";

async function ensureReady(c: PoolClient, id: string) {
  const p = (await c.query("select * from products where id=$1", [id])).rows[0];
  const variants = (
    await c.query(
      `select v.*, (select min(price_cents) from offers where variant_id=v.id and approved and (now() at time zone 'Europe/Sofia')::date between starts and ends) as offer_cents from variants v where product_id=$1`,
      [id],
    )
  ).rows;
  const issues = publicationIssues(p, variants);
  if (
    !variants.some(
      (v) =>
        v.regular_cents !== null ||
        (v.local_cents !== null &&
          (!v.local_until ||
            v.local_until >=
              new Intl.DateTimeFormat("en-CA", {
                timeZone: "Europe/Sofia",
              }).format(new Date()))) ||
        v.offer_cents !== null,
    )
  )
    issues.push("Нужна е потвърдена цена или действаща оферта.");
  if (issues.length)
    throw new InputIssue("За публикуване: " + issues.join(" · "));
}
export async function productCommand(
  c: PoolClient,
  command: string,
  d: Values,
) {
  if (command === "product.bulk") {
    const ids = arr(d, "ids[]");
    if (!ids.length || ids.length > 500)
      throw new InputIssue("Избери поне един продукт.");
    const act = one(d, "operation", [
      "hidden",
      "archived",
      "published",
      "available",
      "unavailable",
    ]);
    for (const productId of [...new Set(ids)].sort()) {
      const id = uuid({ id: productId }, "id");
      await c.query("select id from products where id=$1 for update", [id]);
      if (act === "published") await ensureReady(c, id!);
      if (act === "available" || act === "unavailable")
        await c.query(
          "update products set available=$2,updated_at=now() where id=$1",
          [id, act === "available"],
        );
      else
        await c.query(
          `update products set status=$2,local_settings=case when $2='published' then local_settings||'{"localApproved":true}'::jsonb else local_settings end,updated_at=now() where id=$1`,
          [id, act],
        );
    }
    return {};
  }
  if (command === "product.quick") {
    const id = uuid(d, "id");
    await c.query("select id from products where id=$1 for update", [id]);
    await c.query(
      "update products set available=$2,updated_at=now() where id=$1",
      [id, on(d, "available")],
    );
    if (string(d, "variant"))
      await c.query(
        "update variants set regular_cents=$3 where id=$1 and product_id=$2",
        [uuid(d, "variant"), id, price(d, "regular", true)],
      );
    return {};
  }
  if (command === "product.duplicate") {
    const old = uuid(d, "id"),
      id = randomUUID();
    const p = (
      await c.query("select * from products where id=$1 for share", [old])
    ).rows[0];
    if (!p) throw new InputIssue("Продуктът липсва.");
    await c.query(
      `insert into products(id,slug,name,brand,category_id,description,food,local_settings) values($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        slugify(p.name) + "-" + id.slice(0, 8),
        p.name + " (копие)",
        p.brand,
        p.category_id,
        p.description,
        p.food,
        { seo: p.local_settings.seo },
      ],
    );
    await c.query(
      "insert into variants(product_id,name,pack,unit,regular_cents,local_cents,local_until,available,online_limit,food) select $1,name,pack,unit,regular_cents,local_cents,local_until,available,online_limit,food from variants where product_id=$2",
      [id, old],
    );
    await c.query(
      "insert into images(product_id,url,source,sort_order) select $1,url,'local',sort_order from images where product_id=$2",
      [id, old],
    );
    return { href: "/admin/products/" + id };
  }
  if (command === "product.restore") {
    const id = uuid(d, "id");
    const field = one(d, "field", [
      "name",
      "brand",
      "description",
      "category_id",
      "image",
    ]);
    const p = (
      await c.query("select * from products where id=$1 for update", [id])
    ).rows[0];
    if (!p || p.origin !== "brochure")
      throw new InputIssue("Този продукт няма стойност от брошурата.");
    const source = p.source_data;
    const val =
      field === "image" ? source.image_url || source.image : source[field];
    if (!val)
      throw new InputIssue("Източникът няма потвърдена стойност за това поле.");
    if (field === "image") {
      await c.query("delete from images where product_id=$1 and source=$2", [
        id,
        "local",
      ]);
      if (
        !(
          await c.query("select 1 from images where product_id=$1 and url=$2", [
            id,
            val,
          ])
        ).rowCount
      )
        await c.query(
          "insert into images(product_id,url,source,sort_order) values($1,$2,'brochure',0)",
          [id, val],
        );
    } else
      await c.query("update products set " + field + "=$2 where id=$1", [
        id,
        val,
      ]);
    await c.query(
      "update products set local_settings=$2,updated_at=now() where id=$1",
      [
        id,
        {
          ...p.local_settings,
          overrides: (p.local_settings.overrides || []).filter(
            (n: string) => n !== field,
          ),
        },
      ],
    );
    return {};
  }
  if (command !== "product.save") throw new InputIssue("Неизвестно действие.");
  const id = uuid(d, "id", true) || randomUUID();
  const previous = (
    await c.query("select * from products where id=$1 for update", [id])
  ).rows[0];
  if (
    previous &&
    string(d, "revision") &&
    new Date(previous.updated_at).toISOString() !== d.revision
  )
    throw new InputIssue(
      "Друг служител е променил продукта. Презареди и сравни преди запис.",
    );
  const name = string(d, "name", 220, true),
    brand = string(d, "brand", 160),
    description = string(d, "description", 5000);
  let categoryId = uuid(d, "category", true);
  const newCategory = string(d, "newCategory", 110);
  if (newCategory)
    categoryId = (
      await c.query(
        "insert into categories(slug,name) values($1,$2) on conflict(slug) do update set name=categories.name returning id",
        [slugify(newCategory), newCategory],
      )
    ).rows[0].id;
  const status = one(
    d,
    "status",
    ["draft", "published", "hidden", "archived"],
    previous?.status || "draft",
  );
  const food: Record<string, unknown> = {
    ...(previous?.food || {}),
    type: one(d, "foodType", ["nonfood", "packaged", "unpackaged"], "packaged"),
    withdrawal: one(
      d,
      "withdrawal",
      ["eligible", "perishable", "sealed"],
      "eligible",
    ),
    ageRestricted: on(d, "ageRestricted"),
  };
  for (const key of [
    "ingredients",
    "allergens",
    "net",
    "storage",
    "nutrition",
    "operator",
    "origin",
    "source",
  ])
    food[key] = string(d, key, 3000);
  food.exemptions = arr(d, "exemptions[]").filter((x) =>
    [
      "ingredients",
      "nutrition",
      "allergens",
      "storage",
      "operator",
      "net",
      "origin",
    ].includes(x),
  );
  if ((food.exemptions as string[]).length && !food.source)
    throw new InputIssue("Посочи източник за приложимите изключения.");
  const urls = media(d, "photos"),
    oldImages = (
      await c.query(
        "select * from images where product_id=$1 order by sort_order,id",
        [id],
      )
    ).rows;
  const available = on(d, "available"),
    overrides = new Set<string>(previous?.local_settings.overrides || []);
  if (previous?.origin === "brochure") {
    const fields: Record<string, unknown> = {
      name,
      brand,
      category_id: categoryId,
      description,
      available,
    };
    for (const [key, val] of Object.entries(fields))
      if (previous[key] !== val) overrides.add(key);
    if (JSON.stringify(urls) !== JSON.stringify(oldImages.map((i) => i.url)))
      overrides.add("image");
  }
  const local = {
    ...previous?.local_settings,
    overrides: [...overrides],
    localApproved:
      status === "published" || Boolean(previous?.local_settings.localApproved),
    seo: {
      title: string(d, "seoTitle", 150),
      description: string(d, "seoDescription", 350),
    },
  };
  await c.query(
    `insert into products(id,slug,name,brand,category_id,description,food,available,status,local_settings) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
 on conflict(id) do update set name=excluded.name,brand=excluded.brand,category_id=excluded.category_id,description=excluded.description,food=excluded.food,available=excluded.available,status=excluded.status,local_settings=excluded.local_settings,updated_at=now()`,
    [
      id,
      previous?.slug || slugify(name) + "-" + id.slice(0, 8),
      name,
      brand,
      categoryId,
      description,
      food,
      available,
      status,
      local,
    ],
  );
  const count = integer(d, "variantCount", 1, 120);
  for (let i = 0; i < count; i++) {
    const base = "v" + i + "_";
    const vId = uuid(d, base + "id", true);
    const vName = string(d, base + "name", 180) || name;
    const localMode = one(d, base + "mode", ["source", "local"], "source");
    const keys = [
      "ingredients",
      "allergens",
      "net",
      "storage",
      "nutrition",
      "operator",
      "origin",
      "source",
    ];
    const fields = keys
      .map((k) => [k, string(d, base + "food_" + k, 3000)])
      .filter(([, value]) => value);
    const variantFood = keys.some((k) => base + "food_" + k in d)
      ? Object.fromEntries(fields)
      : null;
    const values = [
      id,
      vName,
      string(d, base + "pack", 120),
      one(d, base + "unit", ["piece", "kg"], "piece"),
      price(d, base + "regular", true),
      localMode === "local" ? price(d, base + "local") : null,
      localMode === "local" ? date(d, base + "until", true) : null,
      on(d, base + "available"),
      grams(d, base + "limit"),
      string(d, base + "barcode", 80) || null,
      variantFood,
    ];
    if (vId) {
      const r = await c.query(
        "update variants set name=$2,pack=$3,unit=$4,regular_cents=$5,local_cents=$6,local_until=$7,available=$8,online_limit=$9,barcode=$10,food=coalesce($11::jsonb,food) where product_id=$1 and id=$12",
        [...values, vId],
      );
      if (!r.rowCount)
        throw new InputIssue("Разновидността не принадлежи на продукта.");
    } else
      await c.query(
        "insert into variants(product_id,name,pack,unit,regular_cents,local_cents,local_until,available,online_limit,barcode,food) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::jsonb,'{}'))",
        values,
      );
  }
  if (JSON.stringify(urls) !== JSON.stringify(oldImages.map((i) => i.url))) {
    await c.query("delete from images where product_id=$1", [id]);
    for (const [i, url] of urls.entries())
      await c.query(
        "insert into images(product_id,url,source,sort_order) values($1,$2,$3,$4)",
        [
          id,
          url,
          i === 0
            ? "local"
            : oldImages.find((row) => row.url === url)?.source || "local",
          i,
        ],
      );
  }
  if (status === "published") await ensureReady(c, id);
  return { href: "/admin/products/" + id };
}
