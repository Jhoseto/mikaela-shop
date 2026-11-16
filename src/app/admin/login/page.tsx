import { AccessForm } from "@/admin/access-form";
import { headers } from "next/headers";
import { allowsLocalAdmin, localAdminEmail } from "@/auth/local-admin";

export default async function Login() {
  const localEmail = allowsLocalAdmin(await headers()) ? localAdminEmail : undefined;
  return <AccessForm mode="login" localEmail={localEmail} />;
}
