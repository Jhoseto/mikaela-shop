import { AccessForm } from "@/admin/access-form";
export default async function TwoFactor({
  searchParams,
}: {
  searchParams: Promise<{ enroll?: string }>;
}) {
  return (
    <AccessForm
      mode={(await searchParams).enroll === "1" ? "enroll" : "verify"}
    />
  );
}
