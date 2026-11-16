import { createStaff } from "../src/auth/manage";
import { pool } from "../src/db";
const { OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME } = process.env;
if (!OWNER_EMAIL || !OWNER_PASSWORD)
  throw Error(
    "Задайте OWNER_EMAIL и OWNER_PASSWORD като променливи на средата.",
  );
try {
  await createStaff(OWNER_NAME || "Собственик", OWNER_EMAIL, OWNER_PASSWORD, [
    "owner",
  ]);
  console.log(
    "Собственикът е създаден. При първи вход се активира двуфакторна защита.",
  );
} finally {
  await pool.end();
}
