import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { databaseUrl, pool } from "../src/db";
import { listFiles, readFile } from "../src/storage";
const mode = process.argv[2],
  url = new URL(databaseUrl);
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z/, "Z");
const root = path.resolve("var/backups");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function safeKey(k: string) {
  return (
    k.length <= 480 &&
    k
      .split("/")
      .every((p) => !!p && p !== "." && p !== ".." && /^[\w.-]+$/.test(p))
  );
}
async function pg(name: string, args: string[], db: URL) {
  const exe = name + (process.platform === "win32" ? ".exe" : "");
  const bundled = path.resolve("var/pg-runtime/pgsql/bin", exe);
  const command = process.env.PG_BIN
    ? path.join(process.env.PG_BIN, exe)
    : await fs.access(bundled).then(
        () => bundled,
        () => exe,
      );
  const variables = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(db.password),
    PGHOST: db.hostname,
    PGPORT: db.port || "5432",
    PGUSER: decodeURIComponent(db.username),
    PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
    PGSSLMODE:
      db.searchParams.get("sslmode") || process.env.PGSSLMODE || "prefer",
  };
  await new Promise<void>((resolve, reject) => {
    const p = spawn(command, args, {
      env: variables,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    p.stderr.on("data", (b) => (error += String(b).slice(-1000)));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(name + " не успя: " + error.slice(-1500))),
    );
  });
}
async function backup() {
  await fs.mkdir(root, { recursive: true });
  const folder = path.join(root, stamp + "-" + randomUUID().slice(0, 6));
  await fs.mkdir(folder);
  const dump = path.join(folder, "database.dump");
  await pg(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--schema=public",
      "--file",
      dump,
    ],
    url,
  );
  const files: Array<{ key: string; sha256: string; size: number }> = [];
  for (const key of await listFiles()) {
    if (!safeKey(key)) throw Error("Невалиден ключ на медия.");
    const data = await readFile(key);
    const target = path.join(folder, "media", key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    files.push({ key, sha256: sha(data), size: data.length });
  }
  const manifest = {
    format: 1,
    created: new Date().toISOString(),
    databaseHash: sha(await fs.readFile(dump)),
    files,
  };
  await fs.writeFile(
    path.join(folder, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(path.relative(process.cwd(), folder));
}
async function restore() {
  const folder = path.resolve(process.argv[3] || ""),
    name = process.argv[4] || "";
  if (!/^mikaela_restore_[a-z0-9_]{1,40}$/.test(name))
    throw Error("Изберете нова база с име mikaela_restore_…");
  const manifest = JSON.parse(
    await fs.readFile(path.join(folder, "manifest.json"), "utf8"),
  );
  const dump = path.join(folder, "database.dump");
  if (
    manifest.format !== 1 ||
    sha(await fs.readFile(dump)) !== manifest.databaseHash
  )
    throw Error("Контролната сума на архива не съвпада.");
  const media = path.resolve("var/restored", name, "media");
  if (
    await fs.stat(path.dirname(media)).then(
      () => true,
      () => false,
    )
  )
    throw Error("Изберете нова директория за възстановяване.");
  for (const f of manifest.files) {
    if (
      !safeKey(f.key) ||
      sha(await fs.readFile(path.join(folder, "media", f.key))) !== f.sha256
    )
      throw Error("Повредена медия в архива.");
  }
  const admin = new URL(databaseUrl);
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.href });
  await c.connect();
  try {
    await c.query('CREATE DATABASE "' + name + '"');
  } finally {
    await c.end();
  }
  const target = new URL(databaseUrl);
  target.pathname = "/" + name;
  const db = new Client({ connectionString: target.href });
  await db.connect();
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    const list = path.resolve("var", "restore-" + randomUUID() + ".list");
    try {
      await pg("pg_restore", ["--list", "--file", list, dump], target);
      const entries = (await fs.readFile(list, "utf8")).split(/\r?\n/);
      await fs.writeFile(
        list,
        entries
          .filter((line) => !line.includes(" SCHEMA - public "))
          .join("\n"),
      );
      await pg(
        "pg_restore",
        [
          "--single-transaction",
          "--exit-on-error",
          "--no-owner",
          "--no-acl",
          "--use-list",
          list,
          "--dbname",
          name,
          dump,
        ],
        target,
      );
    } finally {
      await fs.rm(list, { force: true });
    }
    await fs.mkdir(media, { recursive: true });
    for (const f of manifest.files) {
      const out = path.join(media, f.key);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.copyFile(path.join(folder, "media", f.key), out);
      if (sha(await fs.readFile(out)) !== f.sha256)
        throw Error("Непълно копиране.");
    }
    const {
      rows: [count],
    } = await db.query(
      "SELECT (SELECT count(*) FROM products)::int products,(SELECT count(*) FROM orders)::int orders,(SELECT count(*) FROM images)::int images",
    );
    console.log(
      JSON.stringify({
        database: name,
        media: path.relative(process.cwd(), media),
        verifiedFiles: manifest.files.length,
        ...count,
      }),
    );
  } finally {
    await db.end();
  }
}
try {
  if (mode === "backup") await backup();
  else if (mode === "restore") await restore();
  else throw Error("backup | restore <архив> <нова база>");
} finally {
  await pool.end();
}
