import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
const data = path.resolve("var/postgres-data"),
  port = 55440;
const localBin = path.resolve("var/pg-runtime/pgsql/bin");
const bin = process.env.PG_BIN || (fs.existsSync(localBin) ? localBin : "");
function run(name, args, allowFailure = false) {
  const out = spawnSync(
    path.join(bin, name + (process.platform === "win32" ? ".exe" : "")),
    args,
    {
      encoding: "utf8",
      windowsHide: true,
      stdio: name === "pg_ctl" && args.includes("start") ? "ignore" : "pipe",
    },
  );
  if (out.status !== 0 && !allowFailure)
    throw Error(out.error?.message || out.stderr || out.stdout);
  return out.status;
}
fs.mkdirSync("var", { recursive: true });
if (process.argv[2] === "stop") {
  if (fs.existsSync(path.join(data, "PG_VERSION"))) {
    const status = run("pg_ctl", ["-D", data, "status"], true);
    if (status === 0) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
    else if (status !== 3) throw Error("Не може да се провери състоянието на локалната база.");
  }
  process.exit();
}
const envPath = path.resolve(".env.local");
if (!fs.existsSync(envPath)) {
  const password = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(
    envPath,
    "DATABASE_URL=postgresql://mikaela:" +
      password +
      "@127.0.0.1:" +
      port +
      "/mikaela\nBETTER_AUTH_SECRET=" +
      crypto.randomBytes(40).toString("hex") +
      "\nAPP_URL=http://localhost:3000\nNOTIFICATION_MODE=test\nSTORAGE_DIR=var/media\n",
    { mode: 0o600, flag: "wx" },
  );
}
process.loadEnvFile(envPath);
const url = new URL(process.env.DATABASE_URL);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== String(port) ||
  url.username !== "mikaela"
)
  throw Error("Тази команда управлява само локалната база на проекта.");
if (!fs.existsSync(path.join(data, "PG_VERSION"))) {
  const pwFile = path.resolve("var/pg-init-" + crypto.randomUUID());
  fs.writeFileSync(pwFile, decodeURIComponent(url.password) + "\n", {
    mode: 0o600,
  });
  try {
    run("initdb", [
      "-D",
      data,
      "-U",
      "mikaela",
      "--encoding=UTF8",
      "--locale=C",
      "--auth=scram-sha-256",
      "--pwfile=" + pwFile,
    ]);
  } finally {
    fs.unlinkSync(pwFile);
  }
}
if (run("pg_ctl", ["-D", data, "status"], true) !== 0)
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(data, "server.log"),
    "-o",
    "-p " + port + " -h 127.0.0.1",
    "-w",
    "start",
  ]);
url.pathname = "/postgres";
const client = new pg.Client({
  connectionString: url.href,
  connectionTimeoutMillis: 5000,
});
await client.connect();
try {
  if (
    !(await client.query("SELECT 1 FROM pg_database WHERE datname='mikaela'"))
      .rowCount
  )
    await client.query("CREATE DATABASE mikaela");
} finally {
  await client.end();
}
console.log("Локалната PostgreSQL база е готова на 127.0.0.1:" + port + ".");
