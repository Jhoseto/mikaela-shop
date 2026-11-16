"""Read the spatial text, product images and advertising badges of a grocery flyer."""
import argparse
import hashlib
import io
import json
import math
import os
import re
import subprocess
from datetime import date
from pathlib import Path

import pdfplumber
from pdfminer.pdftypes import resolve1
from PIL import Image


def box(words):
    return [min(w["x0"] for w in words), min(w["top"] for w in words),
            max(w["x1"] for w in words), max(w["bottom"] for w in words)]


def span(a, b):
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def text_runs(words):
    rows = []
    for w in sorted(words, key=lambda v: (round(v["top"]), v["x0"])):
        if not rows or abs(rows[-1][0]["top"] - w["top"]) > 1.8:
            rows.append([])
        rows[-1].append(w)
    lines = []
    for row in rows:
        runs = []
        for w in sorted(row, key=lambda v: v["x0"]):
            if not runs or w["x0"] - runs[-1][-1]["x1"] > max(6, w["size"] * .95):
                runs.append([])
            runs[-1].append(w)
        for run in runs:
            lines.append({"box": box(run), "text": " ".join(w["text"] for w in run)})
    return lines


def descriptions(words):
    # The printed catalog uses a separate typeface for captions; prices and
    # disclaimers must never join a caption simply because they touch it.
    captions = [w for w in words if "Hebar" in w["fontname"] and w["size"] <= 13]
    blocks = []
    for line in text_runs(captions):
        x, y, r, _ = line["box"]
        candidates = []
        for b in blocks:
            last = b["lines"][-1]["box"]
            if -1.8 <= y - last[3] <= 4.4:
                align = min(abs(last[0] - x), abs(last[2] - r))
                if align <= 9.0:
                    candidates.append((align + abs(y-last[3])*.25, b))
        if candidates:
            target = min(candidates, key=lambda t:t[0])[1]
            target["lines"].append(line)
            target["box"] = span(target["box"], line["box"])
        else:
            blocks.append({"box": line["box"], "lines": [line]})
    return [b for b in blocks if b["lines"] and not re.match(
        r"^[*•(]|^\d+[,./]|^\d+(?:x\d+)?$|^пране(?:та)?$|^цена в|^размер$|^Количествата|^Период на|^Офертите", b["lines"][0]["text"], re.I)]


def price_tags(words):
    tags = []
    for token in words:
        if token["text"] != "€" or token["size"] < 11:
            continue
        left = [w for w in words if abs(w["top"]-token["top"]) < 2
                and -1 <= token["x0"]-w["x1"] <= 10
                and re.fullmatch(r"\d+[,.]\d{2}", w["text"])]
        if left:
            w = max(left, key=lambda a: a["x1"])
            tags.append({"box":box([w,token]), "cents":int(w["text"].replace(",", "").replace(".", ""))})
    return sorted(tags, key=lambda t:(round(t["box"][1]/2), t["box"][0]))


def pair(tags, blocks):
    # Minimum-cost bipartite assignment across the entire page. Greedy nearest
    # matching can silently exchange similar neighbouring prices. Extra dummy
    # columns give each price the option of going to manual review.
    if not tags:
        return {}, blocks
    costs=[]
    for t in tags:
        tx,ty,tr,tz=t["box"]
        row=[]
        for b in blocks:
            x,y,r,z=b["box"]
            vertical=max(0,ty-z,y-tz)
            cost=2.1*abs(r-tr)+.62*vertical+(150 if y>tz else 0)
            row.append(cost if abs(r-tr)<148 and vertical<207 else 10000)
        costs.append(row+[290]*len(tags))
    n,m=len(tags),len(costs[0])
    u,v=[0.]*(n+1),[0.]*(m+1)
    p,way=[0]*(m+1),[0]*(m+1)
    for i in range(1,n+1):
        p[0]=i;j0=0
        best=[math.inf]*(m+1);used_cols=[False]*(m+1)
        while True:
            used_cols[j0]=True;i0=p[j0];delta=math.inf;j1=0
            for j in range(1,m+1):
                if used_cols[j]:continue
                cur=costs[i0-1][j-1]-u[i0]-v[j]
                if cur<best[j]:best[j]=cur;way[j]=j0
                if best[j]<delta:delta=best[j];j1=j
            for j in range(m+1):
                if used_cols[j]:u[p[j]]+=delta;v[j]-=delta
                else:best[j]-=delta
            j0=j1
            if p[j0]==0:break
        while j0:
            j1=way[j0];p[j0]=p[j1];j0=j1
    matched={p[j]-1:blocks[j-1] for j in range(1,len(blocks)+1) if p[j]}
    used={j-1 for j in range(1,len(blocks)+1) if p[j]}
    return matched, [b for j,b in enumerate(blocks) if j not in used]


def period(first_page):
    lines = text_runs(first_page)
    for line in lines:
        m = re.search(r"Валидност\s*:?\s*(\d{1,2})\.(\d{1,2})\.?\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})",line["text"],re.I)
        if m:
            d1,m1,d2,m2,y=map(int,m.groups())
            start=date(y-(m1>m2),m1,d1)
            end=date(y,m2,d2)
            if 0 <= (end-start).days <= 92:
                return start.isoformat(),end.isoformat()
    raise ValueError("Не е установен еднозначен срок на ценовите оферти.")


def product_details(lines, is_kg):
    raw = " ".join(lines)
    clean = re.split(r"\s*\(\s*1\s*(?:кг|л|бр|пр|кг\.)|\s*\*Количествата",raw,flags=re.I)[0].strip()
    brand = lines[0] if len(lines)>1 and lines[0] == lines[0].upper() else ""
    pack_match = re.findall(r"(?<!\w)(?:\d+(?:[.,/+–-]\d+)*\s*(?:бр\.?\s*)?[xх×]\s*)?\d+(?:[.,/+–-]\d+)*\s*(?:мл|мг|кг|гр\.?|г|л|бр\.?|см)(?![а-я])",clean,re.I)
    pack = "за кг" if is_kg else pack_match[-1].strip() if pack_match else ""
    ambiguous = bool(re.search(r"различни|разновидност|\d+\s*[/–-]\s*\d+|\b(?:вкусове|аромати|дизайни)\b",raw,re.I))
    if re.search(r"[/,]",re.sub(r"\d[,.]\d","",clean)) or len(pack_match) > 1:
        ambiguous = True
    terms = re.findall(r"\(\s*1\s*(?:кг|л|бр|пр)[^)]{0,70}\)",raw,re.I)
    return clean[:220],brand,pack,ambiguous,terms


CATEGORIES = [
    ("Дом и грижа",r"препарат|омекотител|дезодорант|кърпи|оде[яа]ло|тенджера|дъски|халат|за котки|храна за|тоалетна хартия|за пране"),
    ("Млечни продукти", r"сирене|кашкавал|краве мляко|млечна напитка|йогурт|краве масло|\bскир\b|сладолед"),
    ("Плодове и зеленчуци",r"портокал|круша|ябълк|банан|краставиц"),
    ("Риба и морски дарове", r"скумрия|сьомга|пъстърва|риба тон"),
    ("Месо и колбаси",r"пушен|луканк|шпек|свински|пилеш|пуешк|надениц|кабанос|кренвирш|колбас|шунка|филе"),
    ("Хляб и тестени изделия",r"\bхляб\b|козунак|кроасан|точени кори"),
    ("Сладки и солени изделия",r"шоколад|[бв]исквит|фъстъ|вафл|чипс|снакс|солети|гризини|бонбон|дъвк|пуканки|протеинов бар|\bдесерт\b"),
    ("Напитки",r"кафе|\bсок\b|студен чай|газирана|нектар|бира|водка|уиски|вино|сайдер|питейна|pilsner|lager|coca.cola|sprite|fanta|cappy|queen['’]s"),
    ("Основни храни",r"лютеница|корнишон|риба|ориз|брашно|захар|семена|гроздови"),
]


def sample_photo(pg, record, all_tags, out, stem):
    tx,ty,tr,tz = record["tag"]
    bx,by,br,bz = record["caption"]
    eligible = []
    for img in pg.images:
        x,y,r,z=img["x0"],img["top"],img["x1"],img["bottom"]
        w,h=r-x,z-y
        if w<12 or h<22 or w>pg.width*.64 or h>pg.height*.40:
            continue
        # Price stickers are also embedded images.
        if any(x <= t["box"][0]+3 and t["box"][2]-3 <= r and y<=t["box"][1] and t["box"][3]<=z
               and w < 115 and h < 92 for t in all_tags):
            continue
        cx,cy=(x+r)/2,(y+z)/2
        target_x = tr - 63
        target_y = (min(by,ty)+tz)/2
        if abs(cx-target_x)>100 or abs(cy-target_y)>118:
            continue
        distance = math.hypot((cx-target_x)*1.5, (cy-target_y)) - min(w*h,13000)/1600
        eligible.append((distance,img))
    if not eligible:
        return None, None
    _,chosen=min(eligible,key=lambda t:t[0])
    bounds=(chosen["x0"],chosen["top"],chosen["x1"],chosen["bottom"])
    try:
        stream=chosen["stream"]
        raw=stream.get_data()
        if raw.startswith((b"\xff\xd8",b"\x89PNG",b"\x00\x00\x00\x0c")):
            img=Image.open(io.BytesIO(raw))
        else:
            color = str(resolve1(stream.attrs.get("ColorSpace","")))
            mode="CMYK" if "CMYK" in color else "L" if "Gray" in color else "RGB"
            img=Image.frombytes(mode,chosen["srcsize"],raw)
        if img.mode == "CMYK" and raw[:2] == b"\xff\xd8":
            # PDF's DCT stream Decode array may invert all four channels.
            decode=resolve1(stream.attrs.get("Decode",[]))
            if decode and list(decode)[:2] == [1,0]:
                img=Image.eval(img,lambda v:255-v)
        img=img.convert("RGB")
        mask=resolve1(stream.attrs.get("SMask"))
        if mask:
            mask_data=mask.get_data()
            if mask_data.startswith((b"\xff\xd8",b"\x89PNG")):
                alpha=Image.open(io.BytesIO(mask_data)).convert("L")
            else:
                alpha=Image.frombytes("L",(int(mask["Width"]),int(mask["Height"])),mask_data)
            bg=Image.new("RGB",img.size,"white")
            bg.paste(img,(0,0),alpha.resize(img.size));img=bg
        img.thumbnail((900,900))
        file=stem+"-photo.webp"
        img.save(out/file,quality=89)
        img.thumbnail((400,400))
        img.save(out/(stem+"-photo-card.webp"),quality=82)
        return file,bounds
    except (OSError,ValueError,TypeError,KeyError):
        return None,bounds


def extract(file, out, root):
    out.mkdir(parents=True,exist_ok=True)
    campaign={"items":[], "skipped":[], "pages":[], "parserVersion":5}
    with pdfplumber.open(file) as pdf:
        if not 1 <= len(pdf.pages) <= 24:
            raise ValueError("Документът трябва да съдържа между 1 и 24 страници.")
        for index,pg in enumerate(pdf.pages,1):
            if max(pg.width,pg.height)>1400 or len(pg.chars)>40000:
                raise ValueError("Страница извън допустимите размери.")
            words=pg.dedupe_chars(tolerance=1,extra_attrs=()).extract_words(extra_attrs=["fontname","size"])
            if index==1:
                campaign["starts"],campaign["ends"]=period(words)
            tags=price_tags(words)
            captions=descriptions(words)
            if len(tags)>250 or len(captions)>450:
                raise ValueError("Прекалено много елементи на една страница.")
            matched, unpriced=pair(tags,captions)
            rendered=pg.to_image(resolution=144).original.convert("RGB")
            page_path=f"page-{index}.webp"
            rendered.save(out/page_path,quality=84)
            campaign["pages"].append(page_path)
            scale=rendered.width/pg.width
            for i,tag in enumerate(tags):
                stem=f"p{index}-i{i+1}"
                b=matched.get(i)
                if not b:
                    campaign["skipped"].append({"page":index,"box":tag["box"],"reason":"Цена без надеждно свързано описание."})
                    continue
                lines=[l["text"] for l in b["lines"]]
                tx,ty,tr,tz=tag["box"]
                nearby=[w for w in words if tx-55<w["x0"]<tr+8 and ty-16<w["top"]<tz+16 and w["size"]<12]
                flags=" ".join(w["text"] for w in nearby)
                kg=bool(re.search(r"\bкг\b",flags,re.I) and re.search(r"\bза\b",flags,re.I))
                name,brand,pack,ambiguous,unit_prices=product_details(lines,kg)
                category=next((c for c,r in CATEGORIES if re.search(r,name.split("•",1)[0],re.I)),None)
                article={"page":index,"ordinal":i+1,"name":name,"brand":brand,"pack":pack,
                         "unit":"kg" if kg else "piece","priceCents":tag["cents"],"caption":b["box"],
                         "tag":tag["box"],"text":"\n".join(lines),"category":category,
                         "unitPriceText":unit_prices,"localOnly":"обекти" in flags,
                         "ambiguous":ambiguous,"buy":1,"pay":1,"terms":"","reasons":[]}
                photo,bounds=sample_photo(pg,article,tags,out,stem)
                rect=span(b["box"],tag["box"])
                if bounds:rect=span(rect,bounds)
                rect=[max(0,rect[0]-8),max(0,rect[1]-8),min(pg.width,rect[2]+8),min(pg.height,rect[3]+8)]
                article["photo"]=photo
                article["snippet"]=stem+"-source.webp"
                rendered.crop(tuple(round(v*scale) for v in rect)).save(out/article["snippet"],quality=88)
                article["box"]=rect
                if ambiguous:article["reasons"].append("Уточнете разновидностите и разфасовката.")
                if not pack:article["reasons"].append("Уточнете разфасовката.")
                if not photo:article["reasons"].append("Изберете продуктова снимка.")
                campaign["items"].append(article)
            # A printed price/size table can add another variant to one normal
            # price sticker. Require both column headings and a currency token.
            for head in [w for w in words if w["text"].casefold()=="цена" and w["size"]<11]:
                h=box([head])
                row=[w for w in words if abs(w["top"]-h[1])<3 and h[0]-100<w["x0"]<h[2]+26]
                size_column=next((w for w in row if w["text"].casefold()=="размер"),None)
                if not size_column or not any(w["text"]=="€" for w in row):continue
                prices=[w for w in words if h[3]<=w["top"]<h[3]+50 and abs(w["x0"]-h[0])<12
                        and re.fullmatch(r"\d+[,.]\d{2}",w["text"])]
                for w in prices:
                    if not any(v["text"]=="€" and abs(v["top"]-w["top"])<2 and 0<=v["x0"]-w["x1"]<7 for v in words):continue
                    near=[a for a in campaign["items"] if a["page"]==index and 0<h[1]-a["tag"][3]<55 and abs(h[0]-a["tag"][2])<72]
                    if len(near)!=1:continue
                    parent=near[0]
                    labels=[v for v in words if size_column["x0"]-10<v["x0"]<w["x0"]-5 and v["top"]>=h[3]-1 and v["bottom"]<=w["bottom"]+4]
                    pack=" ".join(line["text"] for line in text_runs(labels))
                    if not pack:continue
                    base=parent["name"].split(" • ")[0]
                    terms=f'{base} · {pack}'
                    ordinal=1+max(a["ordinal"] for a in campaign["items"] if a["page"]==index)
                    extra={**parent,"name":terms,"pack":pack,"ordinal":ordinal,"priceCents":int(w["text"].replace(",","").replace(".","")),
                           "text":parent["text"]+"\n"+pack+" — "+w["text"]+" €","ambiguous":True,"buy":1,"pay":1,"terms":"",
                           "snippet":f"p{index}-i{ordinal}-source.webp","reasons":["Потвърдете размера на допълнителния вариант от таблицата."]}
                    size_pair=re.search(r"Размери:\s*(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*см;\s*(\d+(?:[.,]\d+)?)\s*л\s*/\s*(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*см;\s*(\d+(?:[.,]\d+)?)\s*л",parent["text"],re.I)
                    if size_pair:
                        diam,h1,volume,other,h2,other_volume=size_pair.groups()
                        if re.search(rf"\b{re.escape(other)}\s*см",pack) and other_volume.replace(",",".") in pack.replace(",","."):
                            # Keep source identities stable across parser revisions.
                            parent["identityPack"],extra["identityPack"]=parent["pack"],extra["pack"]
                            parent["pack"]=f"{diam}×{h1} см, {volume.replace('.', ',')} л"
                            extra["pack"]=f"{other}×{h2} см, {other_volume.replace('.', ',')} л"
                            parent["ambiguous"]=extra["ambiguous"]=False
                            for item in (parent,extra):
                                item["reasons"]=[r for r in item["reasons"] if r!="Уточнете разновидностите и разфасовката."]
                    rect=span(parent["box"],[size_column["x0"]-5,h[1]-4,w["x1"]+10,w["bottom"]+6])
                    extra["box"]=rect
                    rendered.crop(tuple(round(v*scale) for v in rect)).save(out/extra["snippet"],quality=88)
                    campaign["items"].append(extra)
            for b in unpriced:
                campaign["skipped"].append({"page":index,"text":" ".join(l["text"] for l in b["lines"]),
                    "box":b["box"],"reason":"Описание без еднозначна цена."})
            if not tags:
                campaign["skipped"].append({"page":index,"reason":"Няма разпознати ценови етикети."})
    if not campaign["items"]:
        raise ValueError("Не са разпознати продуктови позиции. Оригиналът изисква преглед.")
    ocr_command=[os.environ.get("NODE_BINARY","node"),str(root/"scripts/import-ocr.cjs"),str(out)]
    completed=subprocess.run(ocr_command,capture_output=True,timeout=240)
    if completed.returncode:
        raise ValueError("Визуалното разчитане не завърши: "+completed.stderr.decode("utf8",errors="replace")[-450:])
    badges=json.loads(completed.stdout)
    for badge in badges:
        articles=[a for a in campaign["items"] if a["page"]==badge["page"]]
        x,y=badge["x"]/2,badge["y"]/2
        # Graphical conditions are generally printed at the upper left of the tile.
        scored=[(abs(y-a["caption"][1])*2+abs(x-a["box"][0]),a) for a in articles
                if a["caption"][2]>x-5 and a["caption"][2]-x<285 and abs(y-a["caption"][1])<70]
        if scored:
            score,a=min(scored,key=lambda item:item[0])
            if score<245:
                a["terms"]=badge["text"]
                a["promoEvidence"]=badge
                if badge.get("buy") and badge.get("pay") and badge["buy"]>badge["pay"]:
                    a["buy"],a["pay"]=badge["buy"],badge["pay"]
                    a["terms"]=f'Вземи {a["buy"]}, плати {a["pay"]}'
                else:a["reasons"].append("Неясна графична промоция за проверка.")
                # The original excerpt must show the graphic condition, too.
                page_img=Image.open(out/f'page-{a["page"]}.webp')
                rect=span(a["box"],(max(0,x-6),max(0,y-10),x+80,y+40))
                a["box"]=rect
                page_img.crop(tuple(round(v*2) for v in rect)).save(out/a["snippet"],quality=88)
                continue
        campaign["skipped"].append({"page":badge["page"],"reason":"Несвързано графично условие.","text":badge["text"]})
    for a in campaign["items"]:
        identity_pack=a.pop("identityPack",a["pack"])
        key=re.sub(r"[^0-9a-zа-я]+"," ",f'{a["name"]} {a["unit"]} {identity_pack}'.casefold()).strip()
        a["key"]=hashlib.sha256(key.encode()).hexdigest()
    (out/"manifest.json").write_text(json.dumps(campaign,ensure_ascii=False),encoding="utf8")


if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("source",type=Path);p.add_argument("output",type=Path)
    args=p.parse_args()
    extract(args.source,args.output,Path(__file__).resolve().parents[1])
