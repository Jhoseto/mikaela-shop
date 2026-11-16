import { PgBoss } from "pg-boss";
import { pool, databaseUrl, query, tx } from "../src/db";
import { generateSlots } from "../src/commerce/checkout";
import { sendNotifications } from "../src/commerce/notifications";
import { runScheduledImport } from "../src/importer";
import { spawn } from "node:child_process";
const boss = new PgBoss(databaseUrl);
boss.on("error", () => console.error("worker: database error"));
async function tick(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    await query(
      "INSERT INTO worker_state(key,data) VALUES($1,'{\"ok\":true}') ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=now()",
      [name],
    );
  } catch (e) {
    await query(
      "INSERT INTO worker_state(key,data) VALUES($1,'{\"ok\":false}') ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=now()",
      [name],
    );
    throw e;
  }
}
await boss.start();
await boss.createQueue("nightly-backup");
await boss.schedule("nightly-backup", "30 2 * * *", {}, { tz: "Europe/Sofia" });
await boss.work("nightly-backup", () =>
  tick(
    "nightly-backup",
    () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "scripts/backup.ts", "backup"],
          { env: process.env, windowsHide: true, stdio: "ignore" },
        );
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0 ? resolve() : reject(Error("Архивирането не завърши.")),
        );
      }),
  ),
);
for (const [name, schedule, fn] of [
  ["brochure-check", "* * * * *", runScheduledImport],
  ["order-notifications", "* * * * *", sendNotifications],
  ["delivery-calendar", "*/15 * * * *", () => tx(generateSlots)],
] as const) {
  await boss.createQueue(name);
  await boss.schedule(name, schedule, {}, { tz: "Europe/Sofia" });
  await boss.work(name, () => tick(name, () => fn()));
  await boss.send(name, {}, { singletonKey: "startup", singletonSeconds: 60 });
}
console.log("Фоновите задачи работят. Часова зона Europe/Sofia.");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
