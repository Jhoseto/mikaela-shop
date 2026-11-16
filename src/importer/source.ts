import { load } from "cheerio"

export const homepage = "https://www.moiatmagazin.bg/"
export const maxPdfBytes = 50 * 1024 * 1024

function trusted(raw: string): URL {
  const url = new URL(raw, homepage)
  if (url.protocol !== "https:" || !["www.moiatmagazin.bg","moiatmagazin.bg"].includes(url.hostname)
    || url.username || url.password || url.port) throw new Error("Източникът е извън официалния домейн.")
  return url
}

export async function fetchLimited(urlString:string, limit:number):Promise<{data:Buffer,type:string}> {
  let url = trusted(urlString)
  const signal = AbortSignal.timeout(90000)
  for (let hop=0;hop<=3;hop++) {
    const response = await fetch(url, {redirect:"manual",cache:"no-store",signal})
    if ([301,302,303,307,308].includes(response.status)) {
      const next=response.headers.get("location")
      await response.body?.cancel()
      if (!next) throw new Error("Непълно пренасочване от източника.")
      url=trusted(new URL(next,url).href);continue
    }
    if (!response.ok || !response.body) throw new Error(`Източникът отговори с HTTP ${response.status}.`)
    if (Number(response.headers.get("content-length"))>limit) {
      await response.body.cancel();throw new Error("Файлът надвишава допустимия размер.")
    }
    const reader=response.body.getReader(), chunks:Buffer[]=[]
    let total=0
    try {
      for (;;) {
        const {done,value}=await reader.read()
        if (done) break
        total+=value.length
        if (total>limit) {await reader.cancel();throw new Error("Файлът надвишава допустимия размер.")}
        chunks.push(Buffer.from(value))
      }
    } finally { reader.releaseLock() }
    return {data:Buffer.concat(chunks),type:response.headers.get("content-type")??""}
  }
  throw new Error("Прекалено много пренасочвания от източника.")
}

export function discoverLinks(html:string):string[] {
  const $=load(html),found=new Set<string>()
  $("a[href]").each((_,a)=>{
    const raw=$(a).attr("href")!
    try {
      const url=trusted(raw)
      if (/\/offers\//i.test(url.pathname) && /\.pdf$/i.test(url.pathname)) {
        url.hash="";url.searchParams.sort();found.add(url.href)
      }
    } catch { /* The page may legitimately link to unrelated websites. */ }
  })
  if (!found.size) throw new Error("Официалната страница не съдържа връзка към PDF с оферти.")
  if (found.size>8) throw new Error("Необичаен брой брошури на официалната страница. Изисква се преглед.")
  return [...found]
}

export function validatePdf(file:Buffer) {
  if (!file.length || file.length>maxPdfBytes || file.subarray(0,5).toString("ascii")!=="%PDF-"
    || !file.subarray(-2048).includes(Buffer.from("%%EOF"))) throw new Error("Невалиден или непълен PDF файл (максимум 50 MiB).")
}
