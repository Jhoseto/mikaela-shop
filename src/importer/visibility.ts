import {query} from "@/db"
import {currentBrochureBatch,currentBrochureListings} from "./public-listings"
import {getCatalog} from "@/commerce/catalog"

/** Media uploaded during editing belongs to the staff workspace until a
 * published record references it. Thumbnails inherit the original's access. */
export async function isPublishedMedia(key:string):Promise<boolean>{
  const url="/media/"+key
  if(key.startsWith("brochures/")){
    if(/-source\.webp$/i.test(key))return false
    if(/\/original\.pdf$|\/page-\d+\.webp$/i.test(key)){
      const [brochure]=await query(`select 1 from (${currentBrochureBatch}) b
        where $1=b.original_url or $1=b.cover_url`,[url])
      return !!brochure
    }
  }
  const canonical=url.replace(/^(\/media\/uploads\/[a-f\d-]{36}|\/media\/brochures\/[a-f\d]{64}\/v\d+\/p\d+-i\d+-photo)-card\.webp$/i,"$1.webp")
  const [visible]=await query(`WITH brochure_listings AS (${currentBrochureListings}) select (
    exists(select 1 from images i join products p on p.id=i.product_id where i.url=$1 and p.status='published'
      and (coalesce((p.food->>'ageRestricted')::boolean,false)=false or (select value->>'ageEnabled' from settings where key='site')='true'))
    or exists(select 1 from brochure_listings where image_url=$1)
    or exists(select 1 from categories c where c.image_url=$1 and exists(select 1 from products p where p.category_id=c.id and p.status='published'
      and (coalesce(p.food->>'ageRestricted','false')<>'true' or (select value->>'ageEnabled' from settings where key='site')='true')))
    or exists(select 1 from categories c join brochure_listings l on l.category_id=c.id where c.image_url=$1)
    or exists(select 1 from pages where published->>'image'=$1)
    or exists(select 1 from settings where key='site' and $1 in(value->>'logo',value->>'photo',value->'hero'->>'image'))
    ) as visible`,[canonical])
  if(visible?.visible) return true
  if(!/^uploads\/[a-f\d-]{36}(?:-card)?\.webp$/i.test(key)) return false
  const slides=await query<{kind:string;product_id:string}>(`
    SELECT slide->>'kind' AS kind,slide->>'productId' AS product_id
    FROM settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'published'->'slides') slide
    WHERE s.key='heroCarousel' AND s.value->'published'->>'mode'='manual'
      AND slide->>'enabled'='true' AND slide->>'image'=$1`,[canonical])
  if(slides.some(s=>s.kind==="custom")) return true
  const ids=slides.filter(s=>s.kind==="product").map(s=>s.product_id)
  if(!ids.length) return false
  const products=await getCatalog({ids})
  return products.some(p=>p.variants.some(v=>v.price_cents!=null && (v.available || v.listingOnly)))
}
