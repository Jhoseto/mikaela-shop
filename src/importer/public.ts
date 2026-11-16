import { query } from "@/db"

export async function getCurrentBrochure(): Promise<null | {id:string,starts:string,ends:string,pdfUrl:string,coverUrl:string|null}> {
  const [row] = await query(`select c.id,c.starts,c.ends,b.original_url as "pdfUrl",b.cover_url as "coverUrl"
    from brochure_campaigns c join brochure_batches b on b.id=c.current_batch
    where (now() at time zone 'Europe/Sofia')::date between c.starts and c.ends and b.status='success'
    order by c.starts desc,b.finished_at desc limit 1`)
  return row ?? null
}
