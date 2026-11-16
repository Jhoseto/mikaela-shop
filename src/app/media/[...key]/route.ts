import {readFile} from "@/storage"
import {requireStaff} from "@/auth/access"
import {isPublishedMedia} from "@/importer/visibility"
import {createHash} from "node:crypto"

export const dynamic="force-dynamic"
const types:Record<string,string>={webp:"image/webp",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",avif:"image/avif",pdf:"application/pdf"}
const notFound=()=>new Response(null,{status:404,headers:{"Cache-Control":"private,no-store","X-Robots-Tag":"noindex"}})

export async function GET(request:Request,{params}:{params:Promise<{key:string[]}>}){
  const parts=(await params).key
  if(!parts.length||parts.some(p=>!p||p==="."||p===".."||!/^[a-zA-Z0-9_.-]+$/.test(p)))return notFound()
  const key=parts.join("/"),type=types[parts.at(-1)!.split(".").pop()!.toLowerCase()]
  if(!type||key.length>480)return notFound()
  const published=await isPublishedMedia(key)
  if(!published){
    try{await requireStaff(["staff"])}catch{return notFound()}
  }
  const headers:Record<string,string>={
    "Content-Type":type,"X-Content-Type-Options":"nosniff",
    "Cache-Control":published?"public,no-cache,must-revalidate":"private,no-store",
    "Vary":"Cookie",
  }
  if(!published)headers["X-Robots-Tag"]="noindex, nofollow"
  if(published&&(/^(?:uploads\/[a-f\d-]{36}(?:-card)?\.webp|brochures\/[a-f\d]{64}\/(?:original\.pdf|v\d+\/[^/]+))$/i.test(key))){
    headers.ETag='"'+createHash("sha256").update(key).digest("base64url")+'"'
    if(request.headers.get("if-none-match")?.split(",").some(t=>t.trim()===headers.ETag))
      return new Response(null,{status:304,headers})
  }
  let bytes:Buffer
  try{bytes=await readFile(key)}catch{return notFound()}
  if(type==="application/pdf"){
    headers["Accept-Ranges"]="bytes"
    headers["Content-Disposition"]='inline; filename="broshura.pdf"'
    const range=request.headers.get("range")
    if(range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range)
      const start=match?.[1]?Number(match[1]):Math.max(0,bytes.length-Number(match?.[2]))
      const end=match?.[1]&&match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1
      if(!match||!match[1]&&!match[2]||!Number.isSafeInteger(start)||start<0||start>end||start>=bytes.length)
        return new Response(null,{status:416,headers:{...headers,"Content-Range":`bytes */${bytes.length}`}})
      headers["Content-Range"]=`bytes ${start}-${end}/${bytes.length}`
      headers["Content-Length"]=String(end-start+1)
      return new Response(new Uint8Array(bytes.subarray(start,end+1)),{status:206,headers})
    }
  }
  headers["Content-Length"]=String(bytes.length)
  return new Response(new Uint8Array(bytes),{headers})
}
