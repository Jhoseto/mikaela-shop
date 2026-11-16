import { createHash } from "node:crypto"
import { pool, query, tx } from "@/db"
import { putFile } from "@/storage"
import type { PoolClient } from "pg"
import { commitManifest } from "./catalog"
import { parsePdf,parserVersion } from "./parser"
import { getCurrentBrochure } from "./public"
import { discoverLinks,fetchLimited,homepage,maxPdfBytes,validatePdf } from "./source"

const lockId=684200163
const message=(e:unknown)=>e instanceof Error?e.message.slice(-1200):"Неизвестна грешка при обработка."
async function locked<T>(fn:(c:PoolClient)=>Promise<T>) {
  const c=await pool.connect()
  let acquired=false
  try {
    acquired=(await c.query("select pg_try_advisory_lock($1) locked",[lockId])).rows[0].locked
    if (!acquired) return {busy:true}
    return await fn(c)
  } finally {
    if(acquired) await c.query("select pg_advisory_unlock($1)",[lockId])
    c.release()
  }
}
async function processDocument(c:PoolClient,data:Buffer,sourceUrl:string) {
  validatePdf(data)
  const hash=createHash("sha256").update(data).digest("hex")
  const {rows:[existing]}=await c.query(`select b.* from brochure_batches b join brochure_campaigns k on k.current_batch=b.id
    where b.source_hash=$1 and b.status='success' and b.stats->>'parserVersion'=$2 limit 1`,[hash,String(parserVersion)])
  if (existing) {
    await c.query(`insert into brochure_batches(source_url,source_hash,original_url,campaign_id,version,status,finished_at,stats)
      values($1,$2,$3,$4,$5,'duplicate',now(),$6)`,[sourceUrl,hash,existing.original_url,existing.campaign_id,existing.version,{total:existing.stats.total}])
    return {duplicate:true,hash,campaignId:existing.campaign_id}
  }
  const {rows:[batch]}=await c.query("insert into brochure_batches(source_url,source_hash,status) values($1,$2,'processing') returning id",[sourceUrl,hash])
  try {
    const url=await putFile(`brochures/${hash}/original.pdf`,data,"application/pdf")
    await c.query("update brochure_batches set original_url=$1 where id=$2",[url,batch.id])
    const manifest=await parsePdf(data,hash)
    return await tx(t=>commitManifest(t,batch.id,manifest))
  } catch(e) {
    await c.query("update brochure_batches set status='failed',finished_at=now(),error=$2 where id=$1",[batch.id,message(e)])
    throw e
  }
}
export async function importDocument(data:Buffer,sourceUrl:string) {
  return locked(c=>processDocument(c,data,sourceUrl))
}
async function official(c:PoolClient) {
  const {data}=await fetchLimited(homepage,3*1024*1024)
  const urls=discoverLinks(data.toString("utf8"))
  const results=[]
  for (const url of urls) {
    const {data:pdf}=await fetchLimited(url,maxPdfBytes)
    results.push(await processDocument(c,pdf,url))
  }
  return results
}
export async function runScheduledImport() {
  return locked(async c=>{
    // The session lock proves an earlier worker is no longer running.
    await c.query("update brochure_batches set status='failed',finished_at=now(),error='Предходният процес е прекъснат.' where status='processing'")
    const {rows:[job]}=await c.query("select * from brochure_requests where status in ('queued','processing') and next_at<=now() order by created_at limit 1")
    const schedule=(await c.query("select *,next_check<=now() due from brochure_schedule where singleton")).rows[0]
    if (!job && !schedule?.due) return {due:false}
    if(job) await c.query("update brochure_requests set status='processing',tries=tries+1 where id=$1",[job.id])
    const isOfficial=!job||job.kind==="check"
    if(isOfficial) await c.query("update brochure_schedule set last_check=now() where singleton")
    try {
      const result=isOfficial?await official(c):await processDocument(c,job.payload,`upload:${job.source_name}`)
      if(isOfficial) await c.query("update brochure_schedule set last_success=now(),failures=0,last_error=null,next_check=now()+interval_hours*interval '1 hour' where singleton")
      if(job) await c.query("update brochure_requests set status='done',payload=null,error=null where id=$1",[job.id])
      return result
    } catch(e) {
      if(isOfficial) await c.query(`update brochure_schedule set failures=failures+1,last_error=$1,
        next_check=now()+case when failures<2 then (failures+1)*interval '5 minutes' else interval_hours*interval '1 hour' end where singleton`,[message(e)])
      if(job) await c.query(`update brochure_requests set status=case when tries>=3 then 'failed' else 'queued' end,
        payload=case when tries>=3 then null else payload end,next_at=now()+tries*interval '5 minutes',error=$2 where id=$1`,[job.id,message(e)])
      throw e
    }
  })
}
export async function enqueueCheck(actor:string) {
  return tx(async c=>{
    await c.query("select singleton from brochure_schedule where singleton for update")
    const pending=await c.query("select id from brochure_requests where kind='check' and status in ('queued','processing') limit 1")
    if(pending.rowCount) return pending.rows[0].id
    const {rows:[job]}=await c.query("insert into brochure_requests(kind,actor) values('check',$1) returning id",[actor])
    await c.query("insert into audit_log(actor,action,entity) values($1,'brochure.check',$2)",[actor,job.id])
    return job.id
  })
}
export async function enqueueUpload(actor:string,filename:string,data:Buffer) {
  validatePdf(data)
  return tx(async c=>{
    const {rows:[job]}=await c.query("insert into brochure_requests(kind,actor,payload,source_name) values('upload',$1,$2,$3) returning id",
      [actor,data,filename.replace(/[\/\\\p{C}]/gu,"").slice(0,120)])
    await c.query("insert into audit_log(actor,action,entity) values($1,'brochure.upload',$2)",[actor,job.id])
    return job.id
  })
}
export async function getActiveBrochure() {
  const b=await getCurrentBrochure()
  return b?{starts:b.starts,ends:b.ends,pdf_url:b.pdfUrl}:null
}
export async function getBrochureDashboard(batch?:string) {
  const [schedule,batches,campaigns,requests,expiry]=await Promise.all([
    query("select * from brochure_schedule where singleton"),
    query("select b.*,c.starts,c.ends,c.current_batch from brochure_batches b left join brochure_campaigns c on c.id=b.campaign_id order by started_at desc limit 30"),
    query(`select c.*,b.original_url from brochure_campaigns c join brochure_batches b on b.id=c.current_batch
      where c.ends>=(now() at time zone 'Europe/Sofia')::date order by c.starts limit 8`),
    query("select kind,status,tries,error,created_at from brochure_requests order by created_at desc limit 6"),
    query(`select p.id,p.name,v.pack from variants v join products p on p.id=v.product_id
      where p.status='published' and v.regular_cents is null and (v.local_cents is null or v.local_until<(now() at time zone 'Europe/Sofia')::date)
      and exists(select 1 from offers o where o.variant_id=v.id and o.approved and o.ends<(now() at time zone 'Europe/Sofia')::date)
      and not exists(select 1 from offers o where o.variant_id=v.id and o.approved and (now() at time zone 'Europe/Sofia')::date between o.starts and o.ends) limit 50`)
  ])
  const selectedId=batch??campaigns[0]?.current_batch
  const selected=selectedId ? (await query("select * from brochure_batches where id=$1",[selectedId]))[0]
    :(await query("select * from brochure_batches where status='success' order by finished_at desc limit 1"))[0]
  const items=selected ? await query(`select i.*,s.draft_variant,v.product_id from brochure_items i join brochure_sources s using(source_key)
    left join variants v on v.id=s.draft_variant where batch_id=$1 order by page, ordinal`,[selected.id]) : []
  const variants=await query(`select v.id,p.name,v.pack,v.name variant_name,p.id product_id from variants v join products p on p.id=v.product_id
    where p.status not in ('archived','hidden') order by p.name,v.name`)
  return {schedule:schedule[0],batches,campaigns,requests,expiry,selected,items,variants}
}
