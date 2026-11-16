import { requireStaff } from "@/auth/access";
import { Shell } from "@/admin/shell";
import type { ReactNode } from "react";
export default async function DeskLayout({
  children,
}: {
  children: ReactNode;
}) {
  const staff = await requireStaff(["staff"]);
  return (
    <Shell name={staff.name} roles={staff.roles}>
      {children}
    </Shell>
  );
}
