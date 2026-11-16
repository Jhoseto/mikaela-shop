import { query } from "@/db";
export async function liveStats() {
  const [r] = await query(
    `select coalesce(max(number),0)::text latest, count(*) filter(where status='new')::int fresh,coalesce(max(updated_at)::text,'') changed from orders`,
  );
  return r as { latest: string; fresh: number; changed: string };
}
