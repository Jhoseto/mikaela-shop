import fs from "node:fs/promises";
import { pool, tx } from "../src/db/index";
const files = (await fs.readdir("migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => "migrations/" + f);
const importerFiles = await fs.readdir("src/importer");
if (importerFiles.includes("schema.sql")) files.push("src/importer/schema.sql");
files.push(
  ...importerFiles
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort()
    .map((f) => "src/importer/" + f),
);
try {
  await tx(async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtext('mikaela.migrations'))",
    );
    await c.query(
      "CREATE TABLE IF NOT EXISTS migrations(path text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of files) {
      if (
        (await c.query("SELECT 1 FROM migrations WHERE path=$1", [file]))
          .rowCount
      )
        continue;
      await c.query(await fs.readFile(file, "utf8"));
      await c.query("INSERT INTO migrations(path) VALUES($1)", [file]);
      console.log("Приложена: " + file);
    }
  });
} finally {
  await pool.end();
}
