import type { PoolClient } from "pg"
import { tx } from "@/db"
import type { Article } from "./parser"
import { blockers,putOffer,target } from "./catalog"

export type ReviewChoice={
  kind:"approve"|"link"|"variant"|"exclude",variantId?:string,productId?:string,name?:string,pack?:string,
  verified?:boolean,priceCents?:number,buy?:number,pay?:number,terms?:string
}
async function lockedRow(c:PoolClient,id:string) {
  const {rows:[item]}=await c.query(`select i.*,b.campaign_id,c.starts,c.ends,c.current_batch,s.draft_variant
    from brochure_items i join brochure_batches b on b.id=i.batch_id join brochure_campaigns c on c.id=b.campaign_id
    join brochure_sources s using(source_key) where i.id=$1 for update of i,s,c`,[id])
  if (!item||item.batch_id!==item.current_batch) throw new Error("Този запис принадлежи на заменена версия на брошурата.")
  return item
}
async function approve(c:PoolClient,item:any,choice:ReviewChoice,actor:string,bulk:boolean) {
  const a:Article={...item.extracted}
  if (choice.verified) {
    if (choice.priceCents!=null) a.priceCents=choice.priceCents
    if (choice.buy!=null) a.buy=choice.buy
    if (choice.pay!=null) a.pay=choice.pay
    if (choice.terms!=null) a.terms=choice.terms
    if (![a.buy,a.pay,a.priceCents].every(Number.isSafeInteger)||a.buy<1||a.buy>100||a.pay<1||a.pay>a.buy||a.priceCents<=0||a.priceCents>10000000)
      throw new Error("Невалидна цена или пакетна механика.")
    if (a.buy!==a.pay&&!a.terms.trim()) throw new Error("Попълнете условието на пакетната оферта.")
    a.reasons=a.reasons.filter(r=>!r.includes("графична")&&!r.includes("друга цена"))
  }
  if (bulk && (item.old_values && Math.abs(a.priceCents-item.old_values.priceCents)>.35*item.old_values.priceCents ||
      item.reasons.some((r:string)=>r.includes("механика")||r.includes("35%")))) return ["Нужен е индивидуален преглед."]
  let variantId=choice.variantId||item.draft_variant
  if (choice.kind==="variant") {
    if (!choice.productId||!choice.name?.trim()||!choice.pack?.trim()) throw new Error("Изберете продукт и въведете конкретен вариант и разфасовка.")
    const {rows:[v]}=await c.query(`insert into variants(product_id,name,pack,unit)
      select id,$2,$3,$4 from products where id=$1 and status not in ('hidden','archived') returning id`,
      [choice.productId,choice.name.trim(),choice.pack.trim(),a.unit])
    if (!v) throw new Error("Неподходящ продукт за нов вариант.")
    variantId=v.id
  }
  if (!variantId) throw new Error("Изберете местен вариант.")
  const p=await target(c,variantId)
  const issues=blockers(a,p,item.ends,item.starts,!!choice.verified)
  if (p.variant_name==="За уточняване") issues.push("въведете точно име на варианта в продукта")
  if (issues.length) {
    if(choice.kind==="link"||choice.kind==="variant") {
      // Keep the operator's selection even when label data is still incomplete.
      await c.query("update brochure_sources set draft_variant=$1 where source_key=$2",[variantId,item.source_key])
    }
    await c.query("update brochure_items set reasons=$1 where id=$2",[issues,item.id])
    return issues
  }
  const {rows:[used]}=await c.query(`select bl.source_key from brochure_links bl join brochure_items i using(source_key)
    where i.batch_id=$1 and i.source_key<>$2 and bl.variant_id=$3 and i.status<>'ignored' limit 1`,
    [item.batch_id,item.source_key,variantId])
  if (used) throw new Error("Друг артикул от същата брошура е свързан с този вариант.")
  await c.query("update brochure_sources set excluded=false,draft_variant=coalesce(draft_variant,$2) where source_key=$1",[item.source_key,variantId])
  await c.query(`insert into brochure_links(source_key,variant_id,confirmed_by,price_cents,buy,pay) values($1,$2,$3,$4,$5,$6)
    on conflict(source_key,variant_id) do update set confirmed_by=excluded.confirmed_by,confirmed_at=now(),price_cents=excluded.price_cents,
    buy=excluded.buy,pay=excluded.pay`,[item.source_key,variantId,actor,a.priceCents,a.buy,a.pay])
  await c.query(`update products set status='published',local_settings=jsonb_set(local_settings,'{localApproved}','true'),updated_at=now()
    where id=$1 and status in ('draft','published')`,[p.id])
  await putOffer(c,variantId,{id:item.campaign_id,starts:item.starts,ends:item.ends},a,true)
  await c.query("update brochure_items set status='approved',reasons='{}' where id=$1",[item.id])
  return []
}
export async function reviewItem(id:string,choice:ReviewChoice,actor:string) {
  return tx(async c=>{
    await c.query("select pg_advisory_xact_lock($1)",[684200163])
    const item=await lockedRow(c,id)
    let problems:string[]=[]
    if(choice.kind==="exclude") {
      await c.query("update brochure_sources set excluded=true where source_key=$1",[item.source_key])
      await c.query(`update offers set approved=false where campaign_id in (select id from brochure_campaigns where ends>=(now() at time zone 'Europe/Sofia')::date)
        and variant_id in (select variant_id from brochure_links where source_key=$1 union select draft_variant from brochure_sources where source_key=$1)`,[item.source_key])
      await c.query(`update products set status='hidden' where origin='brochure' and source_data->>'source_key'=$1 and status<>'archived'`,[item.source_key])
      await c.query("update brochure_items set status='ignored',reasons='{}' where id=$1",[id])
    } else {
      if(item.status==="ignored") throw new Error("Този артикул е изключен от местния асортимент.")
      problems=await approve(c,item,choice,actor,false)
    }
    await c.query("insert into audit_log(actor,action,entity,detail) values($1,$2,$3,$4)",[actor,"brochure."+choice.kind,id,{choice,problems}])
    return problems
  })
}
export async function bulkApprove(batch:string,actor:string) {
  return tx(async c=>{
    await c.query("select pg_advisory_xact_lock($1)",[684200163])
    const items=await c.query("select id from brochure_items where batch_id=$1 and status='review' order by page,ordinal",[batch])
    let approved=0
    for(const row of items.rows) {
      const item=await lockedRow(c,row.id)
      if(!item.draft_variant) continue
      const issues=await approve(c,item,{kind:"approve"},actor,true)
      if (!issues.length) approved++
    }
    await c.query("insert into audit_log(actor,action,entity,detail) values($1,'brochure.bulk',$2,$3)",[actor,batch,{approved}])
    return approved
  })
}
