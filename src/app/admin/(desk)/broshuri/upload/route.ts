import {NextResponse} from "next/server"
import {requireStaff} from "@/auth/access"
import {sameOrigin,limitedBody,InputIssue,errorResponse} from "@/admin/http"
import {enqueueUpload} from "@/importer"
import {maxPdfBytes} from "@/importer/source"

export async function POST(request:Request) {
  try {
    const staff=await requireStaff(["staff"])
    sameOrigin(request)
    const type=request.headers.get("content-type")||""
    if(!type.startsWith("multipart/form-data")) throw new InputIssue("Изберете PDF файл.")
    const body=await limitedBody(request,maxPdfBytes+64*1024)
    const form=await new Response(new Uint8Array(body),{headers:{"Content-Type":type}}).formData()
    const file=form.get("pdf")
    if(!(file instanceof File)||!file.size) throw new InputIssue("Изберете PDF файл.")
    await enqueueUpload(staff.id,file.name,Buffer.from(await file.arrayBuffer()))
    const url=new URL("/admin/broshuri",request.url)
    url.searchParams.set("notice","PDF файлът е записан за обработка.")
    return NextResponse.redirect(url,{status:303})
  }catch(e){return errorResponse(e)}
}
