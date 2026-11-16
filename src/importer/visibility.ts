import {query} from "@/db"

/** Media uploaded during editing belongs to the staff workspace until a
 * published record references it. Thumbnails inherit the original's access. */
export async function isPublishedMedia(key:string):Promise<boolean>{
  const url="/media/"+key
  if(key.startsWith("brochures/")){
    if(/-source\.webp$/i.test(key))return false
    if(/\/original\.pdf$|\/page-\d+\.webp$/i.test(key)){
      const [brochure]=await query(`select 1 from brochure_campaigns c join brochure_batches b on b.id=c.current_batch
        where (now() at time zone 'Europe/Sofia')::date between c.starts and c.ends
        and b.status='success' and ($1=b.original_url or $1=b.cover_url) limit 1`,[url])
      return !!brochure
    }
  }
  const canonical=url.replace(/^(\/media\/uploads\/[a-f\d-]{36}|\/media\/brochures\/[a-f\d]{64}\/v\d+\/p\d+-i\d+-photo)-card\.webp$/i,"$1.webp")
  const [visible]=await query(`select (
    exists(select 1 from images i join products p on p.id=i.product_id where i.url=$1 and p.status='published'
      and (coalesce((p.food->>'ageRestricted')::boolean,false)=false or (select value->>'ageEnabled' from settings where key='site')='true'))
    or exists(select 1 from categories c where c.image_url=$1 and exists(select 1 from products p where p.category_id=c.id and p.status='published'
      and (coalesce(p.food->>'ageRestricted','false')<>'true' or (select value->>'ageEnabled' from settings where key='site')='true')))
    or exists(select 1 from pages where published->>'image'=$1)
    or exists(select 1 from settings where key='site' and $1 in(value->>'logo',value->>'photo',value->'hero'->>'image'))
    ) as visible`,[canonical])
  return !!visible?.visible
}
