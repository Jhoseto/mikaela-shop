import { saveOffer } from "./offers";
import { saveCarousel } from "./carousel-command";
import { activeLocalBrochure } from "@/commerce/local-brochure";
import type { PoolClient } from "pg";
import { InputIssue } from "./http";
import {
  type Values,
  string,
  uuid,
  on,
  one,
  integer,
  price,
  arr,
  media,
  date,
  time,
  slugify,
} from "./input";

export const pageTitles: Record<string, string> = {
  home: "Начална страница",
  dostavka: "Доставка и плащане",
  "za-magazina": "За магазина",
  kontakti: "Контакти",
  "obshti-usloviya": "Общи условия",
  poveritelnost: "Поверителност и бисквитки",
  "otkaz-i-reklamacii": "Отказ и рекламации",
};
async function site(c: PoolClient) {
  return (
    await c.query("select value from settings where key='site' for update")
  ).rows[0].value;
}
async function writeSite(c: PoolClient, data: Values) {
  await c.query("update settings set value=$1 where key='site'", [data]);
}
export async function manage(c: PoolClient, command: string, d: Values) {
  if (command === "page.carousel") return saveCarousel(c, d);
  if (command === "notification.retry") {
    const r = await c.query(
      "update notification_jobs set status='pending',attempts=0,next_at=now(),last_error=null where id=$1 and status in ('retry','failed') returning id",
      [uuid(d, "id")],
    );
    if (!r.rowCount)
      throw new InputIssue("Известието вече се изпраща или е обработено.");
    return { message: "Известието е върнато за изпращане." };
  }
  if (command === "settings.save") {
    const s = await site(c);
    for (const key of [
      "name",
      "city",
      "address",
      "phone",
      "email",
      "hours",
      "company",
      "companyId",
      "baseUrl",
    ])
      s[key] = string(d, key, 300, key === "name");
    if (s.email && !/^\S+@\S+\.\S+$/.test(s.email))
      throw new InputIssue("Въведи валиден имейл.");
    if (s.baseUrl) {
      let u: URL;
      try {
        u = new URL(s.baseUrl);
      } catch {
        throw new InputIssue("Въведи пълен адрес на сайта.");
      }
      if (
        !["https:", "http:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.pathname !== "/" ||
        u.search ||
        u.hash
      )
        throw new InputIssue("Въведи само домейна с https://.");
    }
    const openSetting = await activeLocalBrochure(c) ? "localOrdersOpen" : "ordersOpen";
    s[openSetting] = on(d, "ordersOpen");
    for (const key of [
      "cardEnabled",
      "registeredFood",
      "transportReady",
      "fiscalReady",
      "brandReady",
      "legalReady",
      "ageEnabled",
      "notificationEmail",
      "notificationSms",
    ])
      s[key] = on(d, key);
    s.extraFeeCents = price(d, "extraFee");
    s.weightTolerance = integer(d, "weightTolerance", 0, 100, 0);
    s.contactAttempts = integer(d, "contactAttempts", 1, 10, 2);
    s.contactWaitMinutes = integer(d, "contactWaitMinutes", 1, 1440, 15);
    s.promoBasis = one(d, "promoBasis", ["delivery", "order"], "delivery");
    s.logo = media(d, "logo")[0] || "";
    s.photo = media(d, "photo")[0] || "";
    if (openSetting === "ordersOpen" && s.ordersOpen && !s.demo) {
      if (
        ![
          "company",
          "companyId",
          "phone",
          "email",
          "address",
          "city",
          "hours",
          "registeredFood",
          "transportReady",
          "fiscalReady",
          "brandReady",
          "legalReady",
        ].every((k) => Boolean(s[k]))
      )
        throw new InputIssue(
          "Попълни фирмените данни, контактите, работното време и потвържденията преди приемане на поръчки.",
        );
      const r = await c.query(
        "select exists(select 1 from pages where slug='obshti-usloviya' and published is not null) legal, exists(select 1 from delivery_zones z where active and not z.test_only and exists(select 1 from delivery_rules r where r.zone_id=z.id and r.capacity>0)) delivery",
      );
      if (!r.rows[0].legal || !r.rows[0].delivery)
        throw new InputIssue(
          "Публикувай общите условия и настрой район с работно време за доставка.",
        );
    }
    await writeSite(c, s);
    return {};
  }
  if (command === "settings.pause") {
    const s = await site(c);
    s[await activeLocalBrochure(c) ? "localOrdersOpen" : "ordersOpen"] = false;
    await writeSite(c, s);
    return {};
  }
  if (command === "synonym.save") {
    const term = string(d, "term", 100, true).toLowerCase();
    const words = [
      ...new Set(
        string(d, "alternatives", 500)
          .split(",")
          .map((s) => s.toLowerCase().trim())
          .filter(Boolean),
      ),
    ];
    if (!words.length)
      await c.query("delete from synonyms where term=$1", [term]);
    else
      await c.query(
        "insert into synonyms(term,alternatives) values($1,$2) on conflict(term) do update set alternatives=excluded.alternatives",
        [term, words],
      );
    return {};
  }
  if (command === "page.save") {
    const slug = one(d, "slug", Object.keys(pageTitles));
    const title = string(d, "title", 150, true),
      body = string(d, "body", 42000);
    const data: Values = { title, body, image: media(d, "image")[0] || "" };
    if (slug === "home") {
      data.button = string(d, "button", 70, true);
      const ids = arr(d, "featured[]").map((v) => uuid({ id: v }, "id"));
      data.featuredIds = [...new Set(ids)].slice(0, 24);
    }
    const prior = (
      await c.query("select * from pages where slug=$1 for update", [slug])
    ).rows[0];
    if (
      prior &&
      string(d, "revision") !== new Date(prior.updated_at).toISOString()
    )
      throw new InputIssue(
        "Страницата е променена в друг прозорец. Презареди преди запис.",
      );
    const publish = d.operation === "publish";
    if (publish && slug !== "home" && !body)
      throw new InputIssue("Попълни текста преди публикуване.");
    await c.query(
      `insert into pages(slug,draft,published,version) values($1,$2,case when $3 then $2::jsonb end,case when $3 then 1 else 0 end)
    on conflict(slug) do update set draft=excluded.draft,published=case when $3 then excluded.draft else pages.published end,version=case when $3 and pages.published is distinct from excluded.draft then pages.version+1 else pages.version end,updated_at=now()`,
      [slug, data, publish],
    );
    if (publish && slug === "home") {
      const s = await site(c);
      s.hero = {
        title,
        subtitle: body,
        image: data.image,
        button: data.button,
      };
      s.featuredIds = data.featuredIds;
      await writeSite(c, s);
    }
    return { message: publish ? "Публикувано." : "Черновата е запазена." };
  }
  if (command === "category.save") {
    const id = uuid(d, "id", true),
      name = string(d, "name", 120, true),
      sort = integer(d, "sortOrder", 0, 10000, 0),
      url = media(d, "image")[0] || "";
    if (id)
      await c.query(
        "update categories set name=$2,sort_order=$3,image_url=$4 where id=$1",
        [id, name, sort, url],
      );
    else
      await c.query(
        "insert into categories(slug,name,sort_order,image_url) values($1,$2,$3,$4)",
        [slugify(name), name, sort, url],
      );
    return {};
  }
  if (command === "zone.save") {
    const id = uuid(d, "id", true);
    const values = [
      string(d, "name", 120, true),
      on(d, "active"),
      price(d, "minimum"),
      price(d, "fee"),
      price(d, "free", true),
      integer(d, "prep", 0, 10080, 0),
      time(d, "cutoff", true),
    ];
    if (id)
      await c.query(
        "update delivery_zones set name=$1,active=$2,min_cents=$3,fee_cents=$4,free_cents=$5,prep_minutes=$6,cutoff=$7 where id=$8",
        [...values, id],
      );
    else
      await c.query(
        "insert into delivery_zones(name,active,min_cents,fee_cents,free_cents,prep_minutes,cutoff) values($1,$2,$3,$4,$5,$6,$7)",
        values,
      );
    return {};
  }
  if (command === "delivery.rule") {
    const zone = uuid(d, "zone"),
      day = integer(d, "weekday", 1, 7),
      start = time(d, "start"),
      end = time(d, "end"),
      capacity = integer(d, "capacity", 0, 2000);
    if (end! <= start!)
      throw new InputIssue("Краят трябва да е след началото на интервала.");
    await c.query("select id from delivery_zones where id=$1 for no key update", [
      zone,
    ]);
    if (
      (
        await c.query(
          `select 1 from delivery_rules where zone_id=$1 and weekday=$2 and start_time<$4 and end_time>$3 and (start_time,end_time)<>($3::time,$4::time) and capacity>0`,
          [zone, day, start, end],
        )
      ).rowCount &&
      capacity
    )
      throw new InputIssue("Друг активен интервал се застъпва с избрания.");
    await c.query(
      "insert into delivery_rules(zone_id,weekday,start_time,end_time,capacity) values($1,$2,$3,$4,$5) on conflict(zone_id,weekday,start_time,end_time) do update set capacity=excluded.capacity",
      [zone, day, start, end, capacity],
    );
    await c.query(
      `update delivery_slots set capacity=$5,active=($5>0) where zone_id=$1 and extract(isodow from day)=$2 and start_time=$3 and end_time=$4 and day>=(now() at time zone 'Europe/Sofia')::date`,
      [zone, day, start, end, capacity],
    );
    return {};
  }
  if (command === "delivery.exception") {
    const zone = uuid(d, "zone"),
      day = date(d, "day");
    await c.query(
      "insert into delivery_exceptions(zone_id,day,closed) values($1,$2,$3) on conflict(zone_id,day) do update set closed=excluded.closed",
      [zone, day, on(d, "closed")],
    );
    return {};
  }
  if (command === "offer.save") return saveOffer(c, d);
  throw new InputIssue("Неизвестно действие.");
}
