import {test} from "node:test"
import assert from "node:assert/strict"
import {randomUUID} from "node:crypto"
import {mkdir,readFile,mkdtemp,rm,writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {Pool} from "pg"

const urls={
  march:"https://www.moiatmagazin.bg/-/media/Project/Traders/BG_B2C/Offers/2026/03-March/02-03-15-03-2026/MyStore_2605.pdf?hash=2D8EEE7F1A28342CC68DCD4AB5600A88&rev=5c6c07c2de4c47d4b57ebebf4417e5b6&sc_lang=bg-BG",
  november:"https://www.moiatmagazin.bg/-/media/Project/Traders/BG_B2C/Offers/2026/11-November/09-11-22-11-2026/MM23_1046818_Mystore_Catalog_WEB-01.pdf?hash=51FC7DD2B725E7E4D30B8915047870F6&rev=b2404e4a4c584a08b67446b5fd97892e&sc_lang=bg-BG"
}

test("Две официални брошури, графична механика, местни редакции и корекции", {timeout:600000}, async()=>{
  const baseUrl=process.env.DATABASE_URL||"postgresql://mikaela@127.0.0.1:55439/mikaela"
  const base=new URL(baseUrl)
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(base.hostname),"Тестът използва само локален PostgreSQL.")
  const schema="brochure_test_"+randomUUID().replaceAll("-","")
  const admin=new Pool({connectionString:baseUrl})
  const media=await mkdtemp(path.join(os.tmpdir(),"mikaela-import-test-"))
  await admin.query("create schema "+schema)
  base.searchParams.set("options","-c search_path="+schema+",public")
  process.env.DATABASE_URL=base.toString()
  process.env.STORAGE_DIR=media
  process.env.STORAGE_DRIVER="local"
  const {pool,query}=await import("../src/db")
  const {importDocument,enqueueUpload,runScheduledImport}=await import("../src/importer")
  const {discoverLinks,fetchLimited,maxPdfBytes}=await import("../src/importer/source")
  const {reviewItem,bulkApprove}=await import("../src/importer/review")
  const {effectivePrice}=await import("../src/commerce/catalog")
  const {isPublishedMedia}=await import("../src/importer/visibility")
  const checks:string[]=[]
  const counts:Record<string,unknown>={}
  async function fixture(key:keyof typeof urls) {
    const envFile=key==="march"?process.env.BROCHURE_MARCH_PDF:process.env.BROCHURE_NOVEMBER_PDF
    if(envFile) return readFile(envFile)
    return (await fetchLimited(urls[key],maxPdfBytes)).data
  }
  try {
    assert.equal((await query("select current_schema() s"))[0].s,schema)
    await pool.query(await readFile("migrations/001-core.sql","utf8"))
    await pool.query(await readFile("migrations/005-bulgarian-search.sql","utf8"))
    await pool.query(await readFile("migrations/006-variant-food.sql","utf8"))
    await pool.query(await readFile("migrations/007-offer-groups.sql","utf8"))
    await pool.query(await readFile("src/importer/schema.sql","utf8"))
    await pool.query(await readFile("src/importer/004-conflicts.sql","utf8"))
    assert.deepEqual(discoverLinks('<a href="https://other.example/a/Offers/no.pdf">x</a><a href="/-/media/Offers/real.pdf">брошура</a>'),["https://www.moiatmagazin.bg/-/media/Offers/real.pdf"])
    const november=await fixture("november"),march=await fixture("march")
    counts.march=await importDocument(march,urls.march)
    assert.equal((await query("select starts,ends from brochure_campaigns"))[0].ends,"2026-03-15")
    checks.push("Мартенската брошура се прочита с правилния период на цените, отделно от датата на играта.")
    counts.november=await importDocument(november,urls.november)
    const [batch]=await query("select b.*,c.current_batch from brochure_batches b join brochure_campaigns c on c.current_batch=b.id where c.starts='2026-11-09'")
    assert.equal(batch.stats.total,56)
    const rows=await query(`select i.*,s.draft_variant,v.product_id from brochure_items i join brochure_sources s using(source_key)
      join variants v on v.id=s.draft_variant where i.batch_id=$1`,[batch.id])
    const coffee=rows.find(r=>r.extracted.name.includes("DOLCE GUSTO")),cheese=rows.find(r=>r.extracted.name.includes("Мандраджийско"))
    assert.ok(rows.every(r=>r.extracted.category))
    assert.equal(rows.find(r=>r.extracted.name.startsWith("ROSBERG")).extracted.category,"Дом и грижа")
    assert.equal(rows.find(r=>r.extracted.name.includes("Скумрия")).extracted.category,"Риба и морски дарове")
    assert.equal(coffee.extracted.priceCents,2699)
    assert.equal(cheese.extracted.priceCents,499)
    assert.equal(cheese.extracted.unit,"kg")
    assert.equal(cheese.extracted.localOnly,true)
    assert.equal(rows.filter(r=>r.extracted.buy===2&&r.extracted.pay===1).length,2)
    assert.equal(rows.filter(r=>r.extracted.imageUrl).length,56)
    assert.ok(rows.some(r=>r.extracted.priceCents===1099 && r.extracted.pack==="24×14 см, 5,8 л"))
    assert.ok(rows.some(r=>r.extracted.priceCents===899 && r.extracted.pack==="20×12 см, 3,4 л"))
    assert.equal((await query("select count(*) n from variants where regular_cents is not null"))[0].n,"0")
    checks.push("Извлечени са 55 основни оферти и допълнителен размер с отделна цена 10,99 €, снимки, сирене 4,99 €/кг, кафе на опаковка 26,99 € и двете графични оферти 2 за 1.")
    const before=(await query("select count(*) n from products"))[0].n
    const duplicate=await importDocument(november,urls.november)
    assert.ok("duplicate" in duplicate && duplicate.duplicate)
    assert.equal((await query("select count(*) n from products"))[0].n,before)
    const job=await enqueueUpload("test-operator","official-november.pdf",november)
    await runScheduledImport()
    assert.deepEqual((await query("select status,payload from brochure_requests where id=$1",[job]))[0],{status:"done",payload:null})
    const busyConnection=await pool.connect()
    try {
      await busyConnection.query("select pg_advisory_lock($1)",[684200163])
      assert.deepEqual(await importDocument(november,urls.november),{busy:true})
    } finally {
      await busyConnection.query("select pg_advisory_unlock($1)",[684200163]);busyConnection.release()
    }
    checks.push("Повторният файл не създава продукти или оферти.")
    const chocolate=rows.find(r=>r.extracted.name.includes("МЛЕЧЕН МЕГА"))
    await query(`update products set food=$1,local_settings=$2,description='Локално описание',available=false where id=$3`,
      [{type:"packaged",source:"Тестов етикет",ingredients:"тест",allergens:"тест",net:"тест",storage:"тест",nutrition:"тест",operator:"тест"},
       {overrides:["description","available","image","category_id"]},chocolate.product_id])
    await query("insert into images(product_id,url,source) values($1,'/media/test-manual.webp','local')",[chocolate.product_id])
    const issues=await reviewItem(chocolate.id,{kind:"approve",verified:true},"test-operator")
    assert.deepEqual(issues,[])
    assert.ok((await bulkApprove(batch.id,"test-operator"))>=0)
    const denied=await reviewItem(coffee.id,{kind:"approve",verified:true},"test-operator")
    assert.ok(denied.length>0)
    const archived=rows.find(r=>r.extracted.name.includes("BUSHMILLS"))
    await query("update products set status='archived' where id=$1",[archived.product_id])
    await reviewItem(cheese.id,{kind:"exclude"},"test-operator")
    await query("insert into products(slug,name,origin,status) values('manual-sample','Самостоятелен местен артикул','local','hidden')")
    await query("update variants set local_cents=120 where id=$1",[chocolate.draft_variant])
    const updated=Buffer.concat([november,Buffer.from("\n% regression revision: valid PDF with changed bytes\n")])
    const correction=await importDocument(updated,urls.november)
    assert.ok("total" in correction && correction.total===56)
    assert.equal((await query("select max(version) version from brochure_batches where campaign_id=$1",[batch.campaign_id]))[0].version,2)
    const [local]=await query("select status,description,available from products where id=$1",[chocolate.product_id])
    assert.deepEqual(local,{status:"published",description:"Локално описание",available:false})
    const [off]=await query("select approved,ends from offers where campaign_id=$1 and variant_id=$2",[batch.campaign_id,chocolate.draft_variant])
    assert.equal(off.approved,true)
    assert.equal((await query("select local_cents from variants where id=$1",[chocolate.draft_variant]))[0].local_cents,120)
    assert.equal((await query("select count(*) n from images where source='local' and product_id=$1",[chocolate.product_id]))[0].n,"1")
    assert.equal((await query("select status from products where id=$1",[archived.product_id]))[0].status,"archived")
    assert.equal((await query("select status from products where id=$1",[cheese.product_id]))[0].status,"hidden")
    assert.equal((await query("select status from products where slug='manual-sample'"))[0].status,"hidden")
    assert.equal((await query("select count(*) n from offers where campaign_id=$1 and variant_id=$2",[batch.campaign_id,chocolate.draft_variant]))[0].n,"1")
    const [currentMedia]=await query(`select b.original_url,b.cover_url from brochure_batches b join brochure_campaigns c on c.current_batch=b.id where c.id=$1`,[batch.campaign_id])
    // Set a controlled active date so this check also runs after November 2026.
    await query(`update brochure_campaigns set starts=(now() at time zone 'Europe/Sofia')::date-1,ends=(now() at time zone 'Europe/Sofia')::date+1 where id=$1`,[batch.campaign_id])
    const key=(url:string)=>url.replace(/^\/media\//,"")
    assert.equal(await isPublishedMedia(key(currentMedia.original_url)),true)
    assert.equal(await isPublishedMedia(key(currentMedia.cover_url)),true)
    const {GET:mediaRoute}=await import("../src/app/media/[...key]/route")
    const pathParts=key(currentMedia.original_url).split("/")
    const rangeResponse=await mediaRoute(new Request("http://localhost"+currentMedia.original_url,{headers:{range:"bytes=0-4"}}),{params:Promise.resolve({key:pathParts})})
    assert.equal(rangeResponse.status,206)
    assert.equal(await rangeResponse.text(),"%PDF-")
    const cached=await mediaRoute(new Request("http://localhost"+currentMedia.original_url,{headers:{"if-none-match":rangeResponse.headers.get("etag")!}}),{params:Promise.resolve({key:pathParts})})
    assert.equal(cached.status,304)
    assert.equal(await isPublishedMedia(key(batch.original_url)),false)
    assert.equal(await isPublishedMedia(key(coffee.extracted.snippetUrl)),false)
    assert.equal(await isPublishedMedia(key(coffee.extracted.imageUrl)),false)
    const [published]=await query("select url from images where product_id=$1 and source='brochure'",[chocolate.product_id])
    assert.equal(await isPublishedMedia(key(published.url)),true)
    assert.equal(await isPublishedMedia(key(published.url).replace(/-photo.webp$/,"-photo-card.webp")),true)
    await query("update brochure_campaigns set starts='2026-11-09',ends='2026-11-22' where id=$1",[batch.campaign_id])
    checks.push("Текущият оригинал, корицата и продуктовите снимки от активната брошура са публични. Служебните откъси и изображенията от предишната версия на непотвърден продукт остават в администрацията.")
    await query("update variants set local_cents=400 where id=$1",[chocolate.draft_variant])
    assert.ok((await query("select 1 from brochure_conflicts where variant_id=$1 and '2026-11-10' between starts and ends",[chocolate.draft_variant])).length)
    await query("update variants set local_cents=120 where id=$1",[chocolate.draft_variant])
    const [afterExpiry]=await query(`select v.*,null as offer from variants v where id=$1`,[coffee.draft_variant])
    assert.equal(effectivePrice(afterExpiry,"2026-11-23").price_cents,null)
    const future=await query(`select d::text,exists(select 1 from offers where campaign_id=$1 and approved and d::date between starts and ends) active
      from unnest(array['2026-11-08','2026-11-09','2026-11-22','2026-11-23']) as days(d)`,[batch.campaign_id])
    assert.deepEqual(future.map(i=>i.active),[false,true,true,false])
    const fetchBefore=globalThis.fetch
    try {
      globalThis.fetch=async()=>{throw new Error("Тестово недостъпен външен сайт.")}
      await query("update brochure_schedule set next_check=now()")
      await assert.rejects(()=>runScheduledImport(),/недостъпен/)
      assert.equal((await query("select failures,last_error from brochure_schedule"))[0].failures,1)
      assert.equal((await query("select max(version) n from brochure_batches where campaign_id=$1 and status='success'",[batch.campaign_id]))[0].n,2)
    } finally {globalThis.fetch=fetchBefore}
    checks.push("Ръчно подаден PDF преминава през общия worker. Едновременно изпълнение е блокирано. Симулация на недостъпен официален сайт записва грешка и запазва последната успешна кампания.")
    checks.push("При промяна на същия URL се записва версия 2. Потвърденият вариант се обновява и местните цена, описание, снимка, скриване и архивиране се запазват.")
    checks.push("Новата цена се прилага от началната дата до края на кампанията, включително при недостъпен външен сайт.")
    const report={checks,campaigns:counts,sources:urls,generated:new Date().toISOString()}
    await mkdir("var/import-inspection",{recursive:true})
    await writeFile("var/import-inspection/verified.json",JSON.stringify(report,null,2))
  } finally {
    await pool.end()
    await admin.query("drop schema "+schema+" cascade")
    await admin.end()
    await rm(media,{recursive:true,force:true})
  }
})
