"use server"
import {redirect} from "next/navigation"
import {revalidatePath} from "next/cache"
import {requireStaff} from "@/auth/access"
import {query,tx} from "@/db"
import {enqueueCheck,enqueueUpload} from "@/importer"
import {readFile as readStoredFile} from "@/storage"
import {bulkApprove,reviewItem,type ReviewChoice} from "@/importer/review"
const base="/admin/broshuri"
const val=(f:FormData,k:string)=>String(f.get(k)||"").trim()
function back(message:string,batch="",item=""):never {
  revalidatePath(base);revalidatePath("/");revalidatePath("/broshura")
  const params=new URLSearchParams({notice:message})
  if (batch) params.set("batch",batch)
  if (item) params.set("item",item)
  redirect(base+"?"+params)
}
export async function checkNow(){
  const actor=await requireStaff(["staff"])
  await enqueueCheck(actor.id)
  back("Проверката е заявена. Фоновият процес ще я изпълни при следващото опресняване.")
}
export async function restoreRevision(f:FormData){
  const actor=await requireStaff(["staff"])
  const [version]=await query(`select b.original_url,b.version from brochure_batches b join brochure_campaigns c on c.id=b.campaign_id
    where b.id=$1 and b.status='success' and c.current_batch<>b.id`,[val(f,"batch")])
  if (!version?.original_url) back("Тази версия вече е текуща или няма съхранен оригинал.")
  const key=version.original_url.replace(/^\/media\//,"")
  const bytes=await readStoredFile(key)
  await enqueueUpload(actor.id,`revision-${version.version}.pdf`,bytes)
  back("Предишният оригинал е подаден за повторна обработка.")
}
export async function setIntervalHours(f:FormData){
  const actor=await requireStaff(["owner"]),hours=Number(val(f,"hours"))
  if(!Number.isInteger(hours)||hours<1||hours>168)back("Изберете интервал между 1 и 168 часа.")
  await tx(async c=>{
    await c.query("update brochure_schedule set interval_hours=$1,next_check=least(next_check,now()+$1*interval '1 hour') where singleton",[hours])
    await c.query("insert into audit_log(actor,action,detail) values($1,'brochure.schedule',$2)",[actor.id,{hours}])
  })
  back("Интервалът е записан.")
}
export async function approveReady(f:FormData){
  const actor=await requireStaff(["staff"]),batch=val(f,"batch")
  let notice
  try {notice=`Одобрени записи: ${await bulkApprove(batch,actor.id)}. Останалите имат задачи за преглед.`}
  catch(e){notice=e instanceof Error?e.message:"Промените не са записани."}
  back(notice,batch)
}
export async function decide(f:FormData){
  const actor=await requireStaff(["staff"]),batch=val(f,"batch"),item=val(f,"item")
  const kind=val(f,"decision") as ReviewChoice["kind"]
  if(!["approve","link","variant","exclude"].includes(kind))throw new Error("Непознато действие.")
  const choice:ReviewChoice={kind,verified:f.get("verified")==="on",variantId:val(f,"variantId")||undefined,
    productId:val(f,"productId")||undefined,name:val(f,"name"),pack:val(f,"pack")}
  const price=val(f,"price")
  if(price)choice.priceCents=/^\d{1,6}(?:[.,]\d{1,2})?$/.test(price) ? Math.round(Number(price.replace(",","."))*100):NaN
  if(val(f,"buy")) choice.buy=Number(val(f,"buy"))
  if(val(f,"pay")) choice.pay=Number(val(f,"pay"))
  if(f.has("terms")) choice.terms=val(f,"terms").slice(0,500)
  let notice
  try {
    const remaining=await reviewItem(item,choice,actor.id)
    notice=remaining.length?"За попълване: "+remaining.join(", "):kind==="exclude"?"Решението за изключване е запомнено.":"Местният вариант и офертата са потвърдени."
  } catch(e){notice=e instanceof Error&&/^[А-Яа-я]/.test(e.message)?e.message:"Промяната не беше записана."}
  back(notice,batch,item)
}
