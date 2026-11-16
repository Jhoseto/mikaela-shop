import type { PoolClient } from "pg"
import { publicationIssues } from "@/commerce/catalog"
import type { Article, Manifest } from "./parser"

type Client=PoolClient
const categories:Record<string,string>={
  "Млечни продукти":"mlechni-produkti","Плодове и зеленчуци":"plodove-zelenchutsi","Месо и колбаси":"meso-kolbasi",
  "Хляб и тестени изделия":"hlyab-testeni","Сладки и солени изделия":"sladki-soleni","Напитки":"napitki",
  "Основни храни":"osnovni-hrani","Дом и грижа":"dom-grizha","Риба и морски дарове":"riba-i-morski-darove"
}
async function sourceValues(c:Client,a:Article) {
  const category=a.category && categories[a.category] ? (await c.query(`insert into categories(slug,name) values($1,$2)
    on conflict(slug) do update set slug=excluded.slug returning id`,[categories[a.category],a.category])).rows[0].id : null
  const home=/Дом и грижа/.test(a.category??"")
  const food={type:home?"nonfood":a.unit==="kg"?"unpackaged":"packaged",
    ageRestricted:/\b(?:vodka|whisky)\b|водка|уиски|бира|lager|pilsner|алкохол|вино/iu.test(a.name)}
  return {name:a.name,brand:a.brand,category_id:category,description:a.text,image_url:a.imageUrl??null,
    food,pack:a.pack,unit:a.unit,price_cents:a.priceCents,available:true,source_key:a.key}
}
export async function target(c:Client,variantId:string) {
  const {rows}=await c.query(`select p.*,v.id variant_id,v.name variant_name,v.food variant_food,v.pack,v.unit,v.local_cents,v.local_until,
    exists(select 1 from images i where i.product_id=p.id) has_image
    from variants v join products p on p.id=v.product_id where v.id=$1 for update of p,v`,[variantId])
  if (!rows[0]) throw new Error("Избраният вариант не съществува.")
  return rows[0]
}
export function blockers(a:Article,p:any,ends:string,starts:string,confirmed:boolean) {
  const reasons=publicationIssues({...p,food:{...p.food,...p.variant_food}},[{name:p.variant_name,pack:p.pack,food:p.variant_food}])
  if (!p.has_image) reasons.push("продуктова снимка")
  if (p.status==="hidden" || p.status==="archived") reasons.push("продуктът е скрит или архивиран")
  if (!Number.isSafeInteger(a.priceCents)||a.priceCents<=0) reasons.push("проверена цена")
  if (p.unit!==a.unit) reasons.push("различна единица за продажба")
  if (p.local_cents!=null && (!p.local_until||p.local_until>=starts) &&
    (p.local_cents>a.priceCents || a.buy>1)) reasons.push("местна цена в конфликт с националната оферта")
  if (a.ambiguous && !confirmed) reasons.push("потвърдете конкретния местен вариант")
  if (a.reasons.some(s=>s.includes("графична"))) reasons.push("разчетете графичното условие")
  if (a.reasons.some(s=>s.includes("друга цена"))) reasons.push("проверете повторения артикул с друга цена или условие")
  if (a.buy>1 && !confirmed) reasons.push("потвърдете правилото на пакетната оферта")
  if (ends<starts) reasons.push("невалиден срок")
  return [...new Set(reasons)]
}

async function upsertPhoto(c:Client,p:any,url:string|null) {
  if (!url||p.local_settings?.overrides?.includes("image")) return
  const previous=(await c.query("select id from images where product_id=$1 and source='brochure' order by sort_order,id limit 1",[p.id])).rows[0]
  if (previous) await c.query("update images set url=$1 where id=$2",[url,previous.id])
  else await c.query("insert into images(product_id,url,source) values($1,$2,'brochure')",[p.id,url])
}

async function draft(c:Client,a:Article) {
  const source=await sourceValues(c,a)
  const {rows:[p]}=await c.query(`insert into products(slug,name,brand,category_id,origin,status,description,food,source_data)
    values($1,$2,$3,$4,'brochure','draft',$5,$6,$7) returning id,local_settings`,[
    "broshura-"+a.key.slice(0,20),source.name,source.brand,source.category_id,source.description,source.food,source])
  const {rows:[v]}=await c.query("insert into variants(product_id,name,pack,unit) values($1,$2,$3,$4) returning id",
    [p.id,a.ambiguous?"За уточняване":a.name,source.pack,source.unit])
  await upsertPhoto(c,p,source.image_url)
  await c.query("update brochure_sources set draft_variant=$1 where source_key=$2",[v.id,a.key])
  return v.id as string
}
async function updateFromSource(c:Client,p:any,a:Article) {
  if(p.origin!=="brochure" || p.source_data?.source_key!==a.key)return
  const data=await sourceValues(c,a)
  const preserve=new Set(p.local_settings?.overrides??[])
  if(p.status==="draft" && p.pack===p.source_data.pack && p.pack!==a.pack)
    await c.query("update variants set pack=$2 where id=$1 and pack=$3",[p.variant_id,a.pack,p.pack])
  await c.query(`update products set food=case when food=source_data->'food' then $2::jsonb->'food' else food end,
    source_data=$2,name=$3,brand=$4,category_id=$5,description=$6,updated_at=now() where id=$1`,
    [p.id,data,preserve.has("name")?p.name:data.name,preserve.has("brand")?p.brand:data.brand,
      preserve.has("category_id")?p.category_id:data.category_id,preserve.has("description")?p.description:data.description])
  await upsertPhoto(c,p,data.image_url)
}

export async function putOffer(c:Client,variantId:string,campaign:any,a:Article,approved:boolean) {
  await c.query(`insert into offers(variant_id,campaign_id,starts,ends,price_cents,buy,pay,terms,approved)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(campaign_id,variant_id) where campaign_id is not null
    do update set starts=excluded.starts,ends=excluded.ends,price_cents=excluded.price_cents,buy=excluded.buy,
    pay=excluded.pay,terms=excluded.terms,approved=excluded.approved`,
    [variantId,campaign.id,campaign.starts,campaign.ends,a.priceCents,a.buy,a.pay,a.terms,approved])
}

export async function commitManifest(c:Client,batch:string,m:Manifest) {
  const {rows:[campaign]}=await c.query(`insert into brochure_campaigns(starts,ends) values($1,$2)
    on conflict(starts,ends) do update set starts=excluded.starts returning *`,[m.starts,m.ends])
  const version=(await c.query("select coalesce(max(version),0)+1 as version from brochure_batches where campaign_id=$1",[campaign.id])).rows[0].version
  // A correction replaces only this campaign. A failed transaction leaves the
  // previous active revision intact, including every previously approved price.
  await c.query("update offers set approved=false where campaign_id=$1",[campaign.id])
  const stats={new:0,changed:0,approved:0,ignored:0,review:0,skipped:m.skipped.length,total:m.items.length,parserVersion:m.parserVersion}
  const signatures=new Map<string,Set<string>>()
  for(const item of m.items) {
    const group=signatures.get(item.key)??new Set<string>()
    group.add([item.priceCents,item.buy,item.pay,item.terms].join("|"))
    signatures.set(item.key,group)
  }
  for (const a of m.items) {
    if(signatures.get(a.key)!.size>1) a.reasons.push("Същият артикул се среща с друга цена или условие.")
    await c.query("insert into brochure_sources(source_key) values($1) on conflict do nothing",[a.key])
    const {rows:[source]}=await c.query("select * from brochure_sources where source_key=$1 for update",[a.key])
    const {rows:links}=await c.query("select * from brochure_links where source_key=$1",[a.key])
    const {rows:[old]}=await c.query(`select i.extracted from brochure_items i join brochure_batches b on b.id=i.batch_id
      where i.source_key=$1 and b.status='success' order by b.finished_at desc limit 1`,[a.key])
    if (old && old.extracted.priceCents!==a.priceCents) stats.changed++
    let status="review", reasons:string[]=[], proposals:unknown[]=[]
    if (source.excluded) {
      status="ignored";stats.ignored++
    } else {
      if (!source.draft_variant && !links.length) {
        source.draft_variant=await draft(c,a);stats.new++
        proposals=(await c.query(`select v.id,v.name,v.pack,p.name as product from variants v join products p on p.id=v.product_id
          where v.id<>$2 and p.status<>'archived' and similarity(shop_search_key(p.name),shop_search_key($1))>.32
          order by similarity(shop_search_key(p.name),shop_search_key($1)) desc limit 3`,[a.name,source.draft_variant])).rows
      }
      if (!links.length) {
        const p=await target(c,source.draft_variant)
        await updateFromSource(c,p,a)
        reasons=["Потвърдете местното участие.",...blockers(a,p,m.ends,m.starts,false)]
        await putOffer(c,source.draft_variant,campaign,a,false)
      } else {
        for (const link of links) {
          const p=await target(c,link.variant_id)
          await updateFromSource(c,p,a)
          const problems=blockers(a,p,m.ends,m.starts,true)
          if (a.buy!==link.buy || a.pay!==link.pay) problems.push("променена промоционална механика")
          if (Math.abs(a.priceCents-link.price_cents)>.35*link.price_cents) problems.push("цената се е променила с над 35%")
          if (!p.local_settings?.localApproved) problems.push("непотвърден местен артикул")
          reasons.push(...problems)
          await putOffer(c,link.variant_id,campaign,a,problems.length===0)
          if (!problems.length) await c.query("update brochure_links set price_cents=$3 where source_key=$1 and variant_id=$2",
            [a.key,link.variant_id,a.priceCents])
        }
        if (!reasons.length) status="approved"
      }
      if (status==="approved") stats.approved++;else stats.review++
    }
    await c.query(`insert into brochure_items(batch_id,source_key,page,ordinal,extracted,old_values,proposals,status,reasons)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[batch,a.key,a.page,a.ordinal,a,old?.extracted??null,JSON.stringify(proposals),status,[...new Set(reasons)]])
  }
  await c.query(`update brochure_batches set campaign_id=$2,version=$3,status='success',cover_url=$4,stats=$5,skipped=$6,finished_at=now() where id=$1`,
    [batch,campaign.id,version,m.coverUrl,stats,JSON.stringify(m.skipped)])
  await c.query("update brochure_campaigns set current_batch=$1 where id=$2",[batch,campaign.id])
  return stats
}
