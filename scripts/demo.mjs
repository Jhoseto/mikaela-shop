import pg from "pg";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw Error("Демо се създава само в локалната среда.");
url.pathname = "/postgres";
const admin = new pg.Client({ connectionString: url.href });
await admin.connect();
try {
  if (
    !(
      await admin.query(
        "SELECT 1 FROM pg_database WHERE datname='mikaela_demo'",
      )
    ).rowCount
  )
    await admin.query("CREATE DATABASE mikaela_demo");
} finally {
  await admin.end();
}
url.pathname = "/mikaela_demo";
if (!fs.existsSync(".env.demo.local"))
  fs.writeFileSync(
    ".env.demo.local",
    "DATABASE_URL=" +
      url.href +
      "\nAPP_URL=http://localhost:3100\nBETTER_AUTH_SECRET=" +
      crypto.randomBytes(40).toString("hex") +
      "\nNOTIFICATION_MODE=test\nSTORAGE_DIR=var/demo-media\n",
    { mode: 0o600, flag: "wx" },
  );
for (const script of ["scripts/migrate.ts", "scripts/seed.ts"]) {
  const env = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "APP_URL",
    "BETTER_AUTH_SECRET",
    "NOTIFICATION_MODE",
    "STORAGE_DIR",
  ])
    delete env[key];
  const result = spawnSync(
    process.execPath,
    ["--env-file=.env.demo.local", "--import", "tsx", script],
    { stdio: "inherit", env, windowsHide: true },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
