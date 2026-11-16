import fs from "node:fs/promises";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { pool, query, tx, databaseUrl } from "../src/db";
import { createStaff } from "../src/auth/manage";
import { importDocument } from "../src/importer";
import { generateSlots } from "../src/commerce/checkout";
import { getSettings } from "../src/commerce/catalog";
const url = new URL(databaseUrl);
if (
  url.pathname !== "/mikaela_demo" ||
  !["127.0.0.1", "localhost"].includes(url.hostname)
)
  throw Error(
    "Демонстрационните данни изискват отделната локална база mikaela_demo.",
  );
const operational = new URL(databaseUrl);
operational.pathname = "/mikaela";
const source = new Pool({ connectionString: operational.href });
try {
  if (
    !(await query("SELECT 1 FROM brochure_batches WHERE status='success'"))
      .length
  ) {
    const [batch] = (
      await source.query(
        "SELECT b.original_url,b.source_url FROM brochure_batches b JOIN brochure_campaigns c ON c.current_batch=b.id WHERE b.status='success' ORDER BY c.starts DESC LIMIT 1",
      )
    ).rows;
    if (!batch)
      throw Error(
        "Изпълнете първия импорт с npm run brochure -- check преди да подготвите демонстрацията.",
      );
    const path = (batch.original_url as string).replace(
      /^\/media\//,
      "var/media/",
    );
    await importDocument(await fs.readFile(path), batch.source_url);
  }
  await tx(async (c) => {
    const pages: Record<string, [string, string]> = {
      "obshti-usloviya": [
        "Общи условия",
        "Демонстрационна среда. Поръчките са учебни и не водят до реална доставка или плащане. Сумите са в евро.",
      ],
      dostavka: [
        "Доставка и плащане",
        "В демонстрационния район можете да изберете свободен интервал и да тествате плащане при получаване.",
      ],
      "za-magazina": [
        "За магазина",
        "Това е локален преглед на онлайн магазин „Микаела“.",
      ],
      kontakti: [
        "Контакти",
        "Данните за контакт на магазина се попълват от собственика.",
      ],
      poveritelnost: [
        "Поверителност и бисквитки",
        "За проверките използвайте учебни данни. Количката се пази в този браузър.",
      ],
      "otkaz-i-reklamacii": [
        "Отказ и рекламации",
        "Подайте искане през защитената връзка към тестовата поръчка.",
      ],
    };
    for (const [slug, [title, body]] of Object.entries(pages))
      await c.query(
        "INSERT INTO pages(slug,draft,published,version) VALUES($1,$2,$2,1) ON CONFLICT DO NOTHING",
        [slug, { title, body }],
      );
    const zone = (
      await c.query(
        "INSERT INTO delivery_zones(name,min_cents,fee_cents,free_cents) VALUES('Демонстрационен район',0,200,2500) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id",
      )
    ).rows[0];
    for (let w = 1; w <= 7; w++)
      await c.query(
        "INSERT INTO delivery_rules(zone_id,weekday,start_time,end_time,capacity) VALUES($1,$2,'14:00','17:00',10) ON CONFLICT DO NOTHING",
        [zone.id, w],
      );
    await generateSlots(c);
    const samples = [
      {
        match: "ДЕСЕРТЕН ПОРТОКАЛ",
        name: "Десертни портокали",
        variant: "Насипни",
        fruit: true,
      },
      {
        match: "КРУША ЛУКАС",
        name: "Круши Лукас",
        variant: "Насипни",
        fruit: true,
      },
      {
        match: "WAVE Млечна напитка%",
        name: "Млечна напитка WAVE",
        variant: "Ягода",
        milk: true,
      },
      {
        match: "K2R Цветоулавящи%",
        name: "Цветоулавящи кърпички K2R",
        variant: "40 кърпички",
      },
      {
        match: "Комплект дъски%",
        name: "Комплект дъски за рязане",
        variant: "Три цвята",
      },
      {
        match: "ARIEL Капсули%",
        name: "Капсули за пране Ariel",
        variant: "Двойна опаковка",
      },
    ];
    const featured: string[] = [];
    for (const s of samples) {
      const item = (
        await c.query(
          "SELECT p.id,v.id vid,p.source_data,p.local_settings FROM products p JOIN variants v ON v.product_id=p.id WHERE p.name ILIKE $1 OR p.name=$2 LIMIT 1",
          [s.match, s.name],
        )
      ).rows[0];
      if (!item) continue;
      if (item.local_settings.demoFixture) {
        featured.push(item.id);
        continue;
      }
      const category = s.milk
        ? "mlechni-produkti"
        : s.fruit
          ? "plodove-zelenchutsi"
          : "dom-grizha";
      const source = "Официална брошура МОЯТ МАГАЗИН, 9–22.11.2026.";
      const food = s.milk
        ? {
            type: "packaged",
            source: "https://cdn.metro-group.com/bg/bg_fir_335687005001_bg.pdf",
            operator: "ОМК ЕАД, гр. Пловдив, бул. Дунав 3",
            ingredients:
              "Краве мляко, обезмаслено краве мляко, захар, ароматизант ягода, оцветител кармин.",
            allergens: "Мляко",
            net: "500 мл",
            storage: "До 25 °C.",
            nutrition:
              "За 100 мл: 269,7 kJ / 63,9 kcal. Мазнини 1,5 г, наситени 0,97 г, въглехидрати 10 г, захари 10 г, белтъци 2,6 г, сол 0,1 г.",
          }
        : s.fruit
          ? {
              type: "unpackaged",
              source,
              exemptions: ["allergens"],
              withdrawal: "perishable",
            }
          : { type: "nonfood", source, withdrawal: "eligible" };
      await c.query(
        "UPDATE products SET status='published',category_id=(SELECT id FROM categories WHERE slug=$4),name=$2,food=$3,description='',local_settings=jsonb_build_object('demoFixture',true,'localApproved',true,'overrides',ARRAY['name','description','category_id']) WHERE id=$1",
        [item.id, s.name, food, category],
      );
      await c.query("UPDATE variants SET name=$2 WHERE id=$1", [
        item.vid,
        s.variant,
      ]);
      await c.query("UPDATE offers SET approved=true WHERE variant_id=$1", [
        item.vid,
      ]);
      featured.push(item.id);
    }
    const site = await getSettings();
    if (!site.demo)
      await c.query(
        "UPDATE settings SET value=value||$1::jsonb WHERE key='site'",
        [
          JSON.stringify({
            demo: true,
            ordersOpen: true,
            featuredIds: featured,
            weightTolerance: 5,
            hero: {
              title: "От квартала до твоята маса.",
              subtitle:
                "Разгледай предложенията от брошурата и избери продукти за своята кошница.",
              button: "Започни да пазаруваш",
            },
          }),
        ],
      );
    await c.query(
      "INSERT INTO synonyms VALUES('портокал',ARRAY['портокали','цитруси']) ON CONFLICT DO NOTHING",
    );
  });
  await fs.mkdir("var/private", { recursive: true });
  for (const [role, name] of [
    ["owner", "Собственик"],
    ["staff", "Служител"],
    ["courier", "Доставчик"],
  ]) {
    const email = role + "@demo.invalid";
    if (!(await query('SELECT 1 FROM "user" WHERE email=$1', [email])).length) {
      const password = randomBytes(21).toString("base64url");
      await createStaff(name, email, password, [role]);
      await fs.appendFile(
        "var/private/demo-access.txt",
        name + "\n" + email + "\n" + password + "\n\n",
        { mode: 0o600 },
      );
    }
  }
  console.log(
    "Демонстрационната база е готова. Достъпът за тестовите роли е в var/private/demo-access.txt.",
  );
} finally {
  await source.end();
  await pool.end();
}
