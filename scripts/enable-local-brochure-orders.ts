import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool, tx } from "../src/db";
import { currentBrochureBatch } from "../src/importer/public-listings";

const envFile = ".env.local";
const zoneName = "Район за пробни поръчки";
const terms = {
  title: "Условия за пробна поръчка",
  body: "При пробна поръчка няма доставка или плащане. Важат цените и сроковете от брошурата. За продуктите на килограм сумата е ориентировъчна. При избор между няколко вкуса или разфасовки посочи желания вариант. Замени се правят само с твое съгласие.",
};
async function enable() {
  const db = new URL(process.env.DATABASE_URL || "");
  const app = new URL(process.env.APP_URL || "");
  const loopback = ["127.0.0.1", "localhost", "[::1]"];
  if (!loopback.includes(db.hostname) || db.pathname !== "/mikaela" ||
      !loopback.includes(app.hostname) || app.port !== "3000" ||
      process.env.NOTIFICATION_MODE !== "test") {
    throw Error("Изискват се основната локална база mikaela, порт 3000 и тестово известяване.");
  }
  const envText = await fs.readFile(envFile, "utf8");
  const active = await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock($1)", [684200163]);
    const campaign = (await c.query(currentBrochureBatch)).rows[0];
    if (!campaign) throw Error("Няма активна брошура.");
    const zone = (await c.query(
      `INSERT INTO delivery_zones(name,test_only,min_cents,fee_cents,prep_minutes)
       VALUES($1,true,0,0,0) ON CONFLICT(name) DO UPDATE SET name=excluded.name
       WHERE delivery_zones.test_only RETURNING id`, [zoneName],
    )).rows[0];
    if (!zone) throw Error("Името на тестовия район вече се използва за реални доставки.");
    await c.query(
      `INSERT INTO delivery_rules(zone_id,weekday,start_time,end_time,capacity)
       SELECT $1,day,'14:00','18:00',20 FROM generate_series(1,7) day ON CONFLICT DO NOTHING`, [zone.id],
    );
    await c.query(
      `INSERT INTO pages(slug,draft,published,version) VALUES ('lokalni-testovi-usloviya',$1,$1,1)
       ON CONFLICT (slug) DO NOTHING`, [terms],
    );
    await c.query(`UPDATE settings SET value=jsonb_set(value,'{localOrdersOpen}','true')
      WHERE key='site' AND NOT value ? 'localOrdersOpen'`);
    await c.query("INSERT INTO audit_log(actor,action,entity,detail) VALUES ('local-setup','local.brochure-orders',$1,$2)",
      [campaign.id, { starts:campaign.starts, ends:campaign.ends }]);
    return campaign;
  });
  const assignment = "LOCAL_BROCHURE_CAMPAIGN=" + active.id;
  const pattern = /^LOCAL_BROCHURE_CAMPAIGN=[^\r\n]*/m;
  const updated = pattern.test(envText) ? envText.replace(pattern, assignment) :
    envText.trimEnd() + "\n" + assignment + "\n";
  if (updated !== envText) {
    const temp = envFile + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temp, updated, { flag: "wx", mode: 0o600 });
      await fs.rename(temp, envFile);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  console.log("Локалното поръчване е настроено за брошурата " + active.starts + " – " + active.ends + ".");
}
try { await enable(); } finally { await pool.end(); }
