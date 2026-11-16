import type { PoolClient } from "pg";
import { pool } from "@/db";
import { currentBrochureBatch } from "@/importer/public-listings";

export const localTermsSlug = "lokalni-testovi-usloviya";

function isLoopback(host: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(host);
}

export function localBrochureCampaign(): string | null {
  const id = process.env.LOCAL_BROCHURE_CAMPAIGN || "";
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ||
    process.env.NOTIFICATION_MODE !== "test"
  )
    return null;
  try {
    const app = new URL(process.env.APP_URL || "");
    const db = new URL(process.env.DATABASE_URL || "");
    if (
      !["http:", "https:"].includes(app.protocol) ||
      !["postgresql:", "postgres:"].includes(db.protocol) ||
      !isLoopback(app.hostname) ||
      !isLoopback(db.hostname) ||
      db.searchParams.has("host") ||
      db.searchParams.has("hostaddr")
    )
      return null;
    return id;
  } catch {
    return null;
  }
}

export async function activeLocalBrochure(c: Pick<PoolClient, "query"> = pool) {
  const id = localBrochureCampaign();
  if (!id) return null;
  const result = await c.query<{ starts: string; ends: string }>(
    `SELECT starts,ends FROM (${currentBrochureBatch}) b WHERE b.id=$1`,
    [id],
  );
  return result.rows[0] ?? null;
}
