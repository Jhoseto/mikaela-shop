import {readFile} from "node:fs/promises"
import path from "node:path"
import {pool,query} from "../src/db"
import {importDocument,runScheduledImport} from "../src/importer"

try {
  const [command,file,officialUrl]=process.argv.slice(2)
  if(command==="file"&&file){
    console.log(JSON.stringify(await importDocument(await readFile(file),officialUrl||"upload:"+path.basename(file)),null,2))
  }else if(command==="check"){
    await query("update brochure_schedule set next_check=now() where singleton")
    console.log(JSON.stringify(await runScheduledImport(),null,2))
  }else{
    throw new Error("Използвайте import.ts check или import.ts file <път-до-pdf> [официален-източник].")
  }
}finally{await pool.end()}
