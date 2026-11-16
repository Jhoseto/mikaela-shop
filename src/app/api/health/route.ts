import { query } from "@/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await query("SELECT 1");
    const rows = await query(
      "SELECT key,updated_at,data FROM worker_state ORDER BY key",
    );
    return Response.json(
      {
        database: "ok",
        jobs: rows.map((r) => ({
          job: r.key,
          ok: r.data.ok,
          updated: r.updated_at,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ database: "unavailable" }, { status: 503 });
  }
}
