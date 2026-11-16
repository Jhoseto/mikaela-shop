import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir, homedir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { putFile } from "@/storage"

export type Article={
  key:string,name:string,brand:string,pack:string,unit:"piece"|"kg",priceCents:number,category:string|null,
  page:number,ordinal:number,text:string,photo:string|null,snippet:string,reasons:string[],ambiguous:boolean,
  buy:number,pay:number,terms:string,localOnly:boolean,box:number[],promoEvidence?:{text:string},
  imageUrl?:string|null,snippetUrl?:string
}
export type Manifest={
  starts:string,ends:string,pages:string[],items:Article[],skipped:Record<string,unknown>[],coverUrl?:string,parserVersion:number
}
export const parserVersion=5
export function pythonExecutable() {
  if (process.env.BROCHURE_PYTHON) return process.env.BROCHURE_PYTHON
  const local=path.join(process.cwd(),".venv",process.platform==="win32"?"Scripts/python.exe":"bin/python")
  if (existsSync(local)) return local
  const bundled=path.join(homedir(),".cache","codex-runtimes","codex-primary-runtime","dependencies","python","python.exe")
  return process.platform==="win32" && existsSync(bundled) ? bundled : process.platform==="win32" ? "python" : "python3"
}
const run=promisify(execFile)
export async function parsePdf(file:Buffer,hash:string):Promise<Manifest>{
  const temp=await mkdtemp(path.join(tmpdir(),"mikaela-brochure-"))
  try {
    const pdf=path.join(temp,"source.pdf")
    await writeFile(pdf,file)
    await run(pythonExecutable(),[path.resolve("python/brochure.py"),pdf,temp],{
      windowsHide:true,timeout:300000,maxBuffer:1024*1024,env:{...process.env, PYTHONIOENCODING:"utf-8",NODE_BINARY:process.execPath}
    })
    const manifest:Manifest=JSON.parse(await readFile(path.join(temp,"manifest.json"),"utf8"))
    async function upload(name:string) {
      if (!/^[a-z0-9-]+\.webp$/.test(name)) throw new Error("Невалидно име на извлечено изображение.")
      return putFile(`brochures/${hash}/v${parserVersion}/${name}`,await readFile(path.join(temp,name)),"image/webp")
    }
    manifest.coverUrl=await upload(manifest.pages[0])
    for (const item of manifest.items) {
      item.imageUrl=item.photo ? await upload(item.photo) : null
      if(item.photo) await upload(item.photo.replace(/-photo\.webp$/,"-photo-card.webp"))
      item.snippetUrl=await upload(item.snippet)
    }
    return manifest
  } finally { await rm(temp,{recursive:true,force:true}) }
}
