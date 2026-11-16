import { query } from "@/db"
import { currentBrochureBatch } from "./public-listings"

export async function getCurrentBrochure(): Promise<null | {id:string,starts:string,ends:string,pdfUrl:string,coverUrl:string|null}> {
  const [row] = await query(`select id,starts,ends,original_url as "pdfUrl",cover_url as "coverUrl"
    from (${currentBrochureBatch}) current_brochure`)
  return row ?? null
}
