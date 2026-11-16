import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { tx } from "@/db";
import { localAdminConfigured, localAdminEmail, localAdminId } from "./local-admin";
function validRoles(roles: string[]) {
  if (
    !roles.length ||
    roles.some((r) => !["owner", "staff", "courier"].includes(r))
  )
    throw Error("Невалидна служебна роля.");
  return [...new Set(roles)];
}
export async function createStaff(
  name: string,
  email: string,
  password: string,
  roles: string[],
) {
  const granted = validRoles(roles);
  email = email.trim().toLowerCase();
  if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12)
    throw Error("Попълнете име, имейл и парола от поне 12 знака.");
  return insertStaff(randomUUID(), name, email, password, granted);
}

export async function createLocalAdmin(password: string) {
  if (!localAdminConfigured() || !password)
    throw Error("Изискват се локалният магазин на порт 3000 и парола.");
  return insertStaff(localAdminId, "Администратор", localAdminEmail, password, ["owner"]);
}

async function insertStaff(id: string, name: string, email: string, password: string, roles: string[]) {
  const hash = await hashPassword(password);
  await tx(async (c) => {
    await c.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
      [id, name, email],
    );
    await c.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$2,$3)',
      [randomUUID(), id, hash],
    );
    for (const role of roles)
      await c.query("INSERT INTO staff_roles VALUES($1,$2)", [id, role]);
  });
  return id;
}
export async function setRoles(id: string, roles: string[]) {
  const granted = validRoles(roles);
  await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('staff.roles'))");
    if (!(await c.query('SELECT 1 FROM "user" WHERE id=$1', [id])).rowCount)
      throw Error("Няма такъв служител.");
    if (
      !granted.includes("owner") &&
      !(
        await c.query(
          "SELECT 1 FROM staff_roles WHERE role='owner' AND user_id<>$1 AND user_id<>$2",
          [id, localAdminId],
        )
      ).rowCount
    )
      throw Error("Нужен е поне един собственик.");
    await c.query("DELETE FROM staff_roles WHERE user_id=$1", [id]);
    for (const role of granted)
      await c.query("INSERT INTO staff_roles VALUES($1,$2)", [id, role]);
    await c.query('DELETE FROM session WHERE "userId"=$1', [id]);
  });
}
