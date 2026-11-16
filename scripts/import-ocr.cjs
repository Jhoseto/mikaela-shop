const fs = require("node:fs/promises")
const path = require("node:path")
const sharp = require("sharp")
const {createWorker, PSM} = require("tesseract.js")

async function recognizeGraphicConditions(directory) {
  const language = path.join(path.dirname(require.resolve("@tesseract.js-data/bul")), "4.0.0_best_int")
  const worker = await createWorker("bul", 1, {langPath: language, cacheMethod: "none"})
  const badges = []
  try {
    await worker.setParameters({tessedit_pageseg_mode: PSM.SPARSE_TEXT})
    const pages = (await fs.readdir(directory)).filter(name => /^page-\d+\.webp$/.test(name))
    for (const name of pages) {
      const page = Number(name.match(/\d+/)[0])
      const file = path.join(directory, name)
      const {data, info} = await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true})
      const mask = Buffer.alloc(info.width * info.height, 255)
      for (let i=0;i<mask.length;i++) {
        const [r,g,b]=[data[i*3], data[i*3+1], data[i*3+2]]
        if (r>85 && r>g*1.7 && r>b*1.45 && g<115 && b<130) mask[i]=0
      }
      const red = await sharp(mask, {raw:{width:info.width,height:info.height,channels:1}}).png().toBuffer()
      const images = [red, await sharp(file).png().toBuffer()]
      const seen = []
      for (const buffer of images) {
        const {data:result} = await worker.recognize(buffer, {}, {tsv:true})
        const words = (result.tsv || "").split("\n").slice(1).map(row=>row.split("\t"))
          .filter(row=>row[0]==="5" && row[11]?.trim())
          .map(row=>({x:Number(row[6]), y:Number(row[7]), w:Number(row[8]), h:Number(row[9]), text:row[11].trim()}))
        const terms = words.filter(w=>/взе[мни]|купи|плат[иі]|безплат|подарък|отстъпк|\d+\s*\+\s*\d+/i.test(w.text))
        for (const token of terms) {
          if (token.h<14 || seen.some(v=>Math.abs(v.x-token.x)<85 && Math.abs(v.y-token.y)<85)) continue
          const line = words.filter(w=>w.x>token.x-20 && w.x<token.x+Math.max(170,token.w*2)
            && w.y>=token.y-7 && w.y<token.y+token.h*3.5)
            .sort((a,b)=>Math.abs(a.y-b.y)<10 ? a.x-b.x : a.y-b.y)
          const text = line.map(w=>w.text).join(" ")
          const group = text.match(/(?:взе[мни][а-я]*|купи)\s*[:+]?\s*(\d+)\D{0,28}плат[иі]\s*[:+]?\s*(\d+)/i)
          if (!group && !/взем|плати|безплат|отстъпк|подарък/i.test(text)) continue
          const badge = {page,x:token.x,y:token.y,text}
          if (group) Object.assign(badge,{buy:Number(group[1]),pay:Number(group[2])})
          const nearby = badges.find(b=>b.page===page && Math.abs(b.x-token.x)<85 && Math.abs(b.y-token.y)<85)
          if (nearby && group && !nearby.buy) Object.assign(nearby,badge)
          else if (!nearby) badges.push(badge)
          if (group) seen.push(token)
        }
      }
    }
    return badges
  } finally { await worker.terminate() }
}
recognizeGraphicConditions(process.argv[2]).then(result=>process.stdout.write(JSON.stringify(result)))
  .catch(error=>{console.error(error);process.exitCode=1})
