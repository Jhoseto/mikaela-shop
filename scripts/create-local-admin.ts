import { pool } from "../src/db";
import { createLocalAdmin } from "../src/auth/manage";

try {
  await createLocalAdmin(process.env.LOCAL_ADMIN_PASSWORD || "");
  console.log("Локалният профил admin е създаден.");
} finally {
  await pool.end();
}
