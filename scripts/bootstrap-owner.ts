import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { pool, query } from "../src/db";
import { createStaff } from "../src/auth/manage";
import { localAdminId } from "../src/auth/local-admin";
try {
  if (
    !(await query("SELECT 1 FROM staff_roles WHERE role='owner' AND user_id<>$1 LIMIT 1", [localAdminId]))
      .length
  ) {
    const email = "owner@localhost.invalid";
    const password = randomBytes(24).toString("base64url");
    await fs.mkdir("var/private", { recursive: true });
    await fs.writeFile(
      "var/private/owner-access.txt",
      "Локален собственик\n" +
        email +
        "\n" +
        password +
        "\nПри първия вход добавете удостоверител за двуфакторна защита.\n",
      { flag: "wx", mode: 0o600 },
    );
    await createStaff("Собственик", email, password, ["owner"]);
    console.log("Локален собственик: var/private/owner-access.txt");
  }
} finally {
  await pool.end();
}
