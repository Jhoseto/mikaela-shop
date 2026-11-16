import { Pool, types, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
types.setTypeParser(1082, (value) => value);
const g = globalThis as typeof globalThis & { mikaelaPool?: Pool };
export const databaseUrl =
  process.env.DATABASE_URL || "postgresql://mikaela@127.0.0.1:55440/mikaela";
export const pool = (g.mikaelaPool ??= new Pool({
  connectionString: databaseUrl,
  max: 12,
}));
export const db = drizzle(pool);
export async function query<T = any>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}
export async function tx<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
