import Link from "next/link"
import {requireStaff} from "@/auth/access"
import {PageHeading,Panel,Empty} from "@/admin/presentation"
import {getBrochureDashboard} from "@/importer"
import {today} from "@/commerce/catalog"
import {approveReady,checkNow,decide,setIntervalHours,restoreRevision} from "./actions"
import "./review.css"
export const dynamic="force-dynamic"
const formatDate=(d:string|Date)=>new Intl.DateTimeFormat("bg-BG",{dateStyle:"medium",timeZone:"Europe/Sofia"}).format(new Date(d))
const clock=(d:string|Date|null)=>d?new Intl.DateTimeFormat("bg-BG",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Sofia"}).format(new Date(d)):"Няма проверка"
const money=(n:number)=>new Intl.NumberFormat("bg-BG",{style:"currency",currency:"EUR"}).format(n/100)
const labels:Record<string,string>={approved:"Одобрен",review:"За преглед",ignored:"Пропуснат",success:"Обработен",failed:"Грешка",duplicate:"Без промяна",processing:"Обработва се",queued:"Изчаква",done:"Завършена"}
const uuid=(v?:string)=>v&&/^[0-9a-f-]{36}$/i.test(v)?v:undefined
export default async function Brochures({searchParams}:{searchParams:Promise<{batch?:string,item?:string,notice?:string}>}){
  const staff=await requireStaff(["staff"]),params=await searchParams
  const data=await getBrochureDashboard(uuid(params.batch)),batch=data.selected
  const selected=data.items.find(i=>i.id===params.item),a=selected?.extracted
  const roots=[...new Map(data.variants.map(v=>[v.product_id,v])).values()]
  return <div className="brochure-desk">
    <PageHeading title="Брошури" subtitle="Проверка на офертите и местния асортимент." action={<form action={checkNow}><button className="adm-btn">Провери сега</button></form>}/>
    {params.notice&&<p className="br-notice" role="status">{params.notice.slice(0,500)}</p>}
    <div className="br-top">
      <Panel title="Кампании">{data.campaigns.length?data.campaigns.map(c=><p key={c.id}><strong>{c.starts>today()?"Предстояща":"Актуална"} · </strong><Link href={`?batch=${c.current_batch}`}>{formatDate(c.starts)} – {formatDate(c.ends)}</Link></p>):<Empty>Няма активна или предстояща брошура.</Empty>}
      <p>Последна успешна проверка <b>{clock(data.schedule.last_success)}</b><br/>Следваща проверка <b>{clock(data.schedule.next_check)}</b></p>
      {data.schedule.last_error&&<p role="alert">{data.schedule.last_error}</p>}
      {staff.roles.includes("owner")&&<form action={setIntervalHours}><label>Проверявай на <input name="hours" type="number" min="1" max="168" required defaultValue={data.schedule.interval_hours}/> часа</label> <button>Запази</button></form>}</Panel>
      <Panel title="Ръчно качване"><form method="post" action="/admin/broshuri/upload" encType="multipart/form-data"><label>Оригинална брошура (PDF, до 50 MiB)<input name="pdf" type="file" accept="application/pdf" required/></label><button>Качи PDF</button></form>
      {data.requests.map((r,i)=><p key={i}>{clock(r.created_at)} · {r.kind==="check"?"Проверка":"Качен файл"} · {labels[r.status]} {r.error}</p>)}</Panel>
    </div>
    {data.expiry.length>0&&<Panel title="Изтекла оферта без редовна цена">{data.expiry.map((p,i)=><p key={i}><Link href={`/admin/products/${p.id}`}>{p.name} {p.pack}</Link></p>)}</Panel>}
    {batch?.status==="success"&&<Panel title="Прегледай промените"><div className="br-summary">
      <div>Нови продукти <b>{batch.stats.new}</b></div><div>Променени цени <b>{batch.stats.changed}</b></div>
      <div>За преглед <b>{data.items.filter(i=>i.status==="review").length}</b></div><div>Пропуснати <b>{batch.skipped.length+data.items.filter(i=>i.status==="ignored").length}</b></div>
      </div><a href={batch.original_url} target="_blank" rel="noreferrer">Отвори оригиналната брошура</a>
      <form action={approveReady}><input type="hidden" name="batch" value={batch.id}/><button>Одобри готовите</button> <small>Потвърждава местното участие на готовите записи.</small></form>
      <div className="br-index">{data.items.map(i=><Link className={selected?.id===i.id?"br-active":""} key={i.id} href={`?batch=${batch.id}&item=${i.id}#review`}><span>{i.extracted.name}</span><small>стр. {i.page} · {money(i.extracted.priceCents)} · {labels[i.status]}</small></Link>)}</div>
      {selected&&<article id="review" className="br-details">
        <img alt={`Откъс от страница ${a.page} за ${a.name}`} src={a.snippetUrl}/>
        <div><h3>{a.name}</h3><p className="br-text">{a.text}</p><p>{selected.old_values?`Предишна цена ${money(selected.old_values.priceCents)} → `:""}<strong>{money(a.priceCents)}</strong> {a.terms}</p>
        {a.localOnly&&<p>Офертата е само за определени обекти.</p>}
        {selected.reasons.length>0&&<p><b>За преглед</b> · {selected.reasons.join(" · ")}</p>}
        {selected.proposals.length>0&&<p>Предложени съвпадения: {selected.proposals.map((s:{product:string,pack:string})=>s.product+" "+s.pack).join(", ")}</p>}
        {selected.product_id&&<Link href={`/admin/products/${selected.product_id}`}>Редактирай местния продукт и данните от етикета</Link>}
        {selected.status!=="ignored"&&<form action={decide} className="br-form"><input name="batch" type="hidden" value={batch.id}/><input name="item" type="hidden" value={selected.id}/>
        <label>Свържи със съществуващ вариант<select name="variantId" defaultValue=""><option value="">Използвай предложения местен вариант</option>{data.variants.map(v=><option key={v.id} value={v.id}>{v.name} · {v.variant_name} · {v.pack}</option>)}</select></label>
        <div className="br-numbers"><label>Цена €<input name="price" inputMode="decimal" defaultValue={(a.priceCents/100).toFixed(2)} required/></label><label>Вземи<input type="number" min="1" max="100" name="buy" defaultValue={a.buy}/></label><label>Плати<input type="number" min="1" max="100" name="pay" defaultValue={a.pay}/></label></div>
        <label>Промоционално условие<input name="terms" defaultValue={a.terms}/></label>
        <label><input type="checkbox" name="verified"/> Проверих конкретната разновидност, цената, условието и местното участие.</label>
        <div><button name="decision" value="approve">Одобри артикула</button> <button name="decision" value="link">Свържи със съществуващ продукт</button></div>
        <details><summary>Създай нов вариант</summary><label>Продукт<select name="productId" defaultValue={selected.product_id??""}>{roots.map(v=><option key={v.product_id} value={v.product_id}>{v.name}</option>)}</select></label><label>Точно наименование<input name="name"/></label><label>Разфасовка<input name="pack" defaultValue={a.pack}/></label><button name="decision" value="variant">Създай нов вариант</button></details>
        <button name="decision" value="exclude" className="br-exclude">Не предлагаме този артикул</button></form>}</div></article>}
      {batch.skipped.length>0&&<details><summary>Пропуснати части от документа ({batch.skipped.length})</summary>{batch.skipped.map((s:any,i:number)=><p key={i}>Стр. {s.page} · {s.reason} {s.text}</p>)}</details>}
    </Panel>}
    <Panel title="История на импортите">{data.batches.length?data.batches.map(b=><div key={b.id}><strong>{clock(b.started_at)}</strong> · {labels[b.status]} {b.version?`· версия ${b.version}`:""} {b.status==="success"&&<Link href={`?batch=${b.id}`}>Прегледай промените</Link>} {b.error}
      {b.status==="success"&&b.current_batch!==b.id&&<form action={restoreRevision}><input type="hidden" name="batch" value={b.id}/><button>Възстанови от тази версия</button></form>}</div>):<Empty>Все още няма изпълнен импорт.</Empty>}</Panel>
  </div>
}
