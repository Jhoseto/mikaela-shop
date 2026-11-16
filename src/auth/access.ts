import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./index";
import { query } from "@/db";
import { allowsLocalAdmin, localAdminId } from "./local-admin";
export type Actor = { id: string; roles: string[] };
export async function requireStaff(
  roles: string[] = ["owner", "staff", "courier"],
) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/admin/login");
  const localAdmin = session.user.id === localAdminId;
  if (localAdmin && !allowsLocalAdmin(requestHeaders)) redirect("/admin/login");
  const assigned = (
    await query("SELECT role FROM staff_roles WHERE user_id=$1", [
      session.user.id,
    ])
  ).map((r) => r.role as string);
  if (assigned.includes("owner") && !localAdmin && !session.user.twoFactorEnabled)
    redirect("/admin/2fa?enroll=1");
  if (!assigned.includes("owner") && !assigned.some((r) => roles.includes(r))) {
    if (assigned.includes("courier") && !roles.includes("courier"))
      redirect("/dostavchik");
    throw Error("Нямате права за това действие.");
  }
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    roles: assigned,
  };
}
