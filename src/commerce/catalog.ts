import { query } from "@/db";
import { sql } from "drizzle-orm";
import { db } from "@/db";
export const siteDefaults = {
  name: "Моят Магазин Микаела",
  city: "",
  address: "",
  phone: "",
  email: "",
  hours: "",
  logo: "",
  photo: "",
  company: "",
  companyId: "",
  ordersOpen: false,
  cardEnabled: false,
  demo: false,
  baseUrl: "",
  extraFeeCents: 0,
  weightTolerance: 0,
  termsVersion: 0,
  hero: {
    title: "Предложения от брошурата",
    subtitle: "",
    image: "",
    button: "Започни да пазаруваш",
  },
  featuredIds: [] as string[],
  ageEnabled: false,
  registeredFood: false,
  transportReady: false,
  fiscalReady: false,
  brandReady: false,
  legalReady: false,
  promoBasis: "delivery",
  contactAttempts: 2,
  contactWaitMinutes: 15,
};
export async function getSettings(): Promise<typeof siteDefaults> {
  const result = await db.execute(
    sql`SELECT value,(SELECT version FROM pages WHERE slug='obshti-usloviya' AND published IS NOT NULL) AS legal_version FROM settings WHERE key='site'`,
  );
  const r = result.rows[0] as any;
  return {
    ...siteDefaults,
    ...r?.value,
    termsVersion: Number(r?.legal_version || 0),
    hero: { ...siteDefaults.hero, ...r?.value?.hero },
  };
}
export async function getPage(slug: string) {
  const [r] = await query(
    "SELECT published,version FROM pages WHERE slug=$1 AND published IS NOT NULL",
    [slug],
  );
  return r ? { ...r.published, version: r.version } : null;
}
export function today() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function publicationIssues(product: any, variants: any[]): string[] {
  const missing: string[] = [];
  if (!String(product.name || "").trim()) missing.push("име");
  if (!product.category_id) missing.push("категория");
  if (
    !variants.length ||
    variants.some(
      (v) =>
        !v.name ||
        !v.pack ||
        /^(?:за уточняване|различни (?:вкусове|видове|размери))$/iu.test(
          v.name.trim(),
        ),
    )
  )
    missing.push("точен вариант и разфасовка");
  for (const variant of variants.length ? variants : [{}]) {
    const food = { ...(product.food || {}), ...(variant.food || {}) };
    const at = (label: string) =>
      variants.length > 1 ? label + " (" + variant.name + ")" : label;
    if (!["nonfood", "packaged", "unpackaged"].includes(food.type))
      missing.push(at("тип на стоката"));
    if (["packaged", "unpackaged"].includes(food.type)) {
      const required =
        food.type === "packaged"
          ? {
              source: "източник на етикета",
              ingredients: "състав",
              allergens: "алергени",
              net: "нетно количество",
              storage: "съхранение",
              nutrition: "хранителни стойности",
              operator: "отговорен оператор",
            }
          : { source: "източник на информацията", allergens: "алергени" };
      for (const [key, label] of Object.entries(required))
        if (
          !String(food[key] ?? "").trim() &&
          !(key !== "source" && food.exemptions?.includes(key))
        )
          missing.push(at(label as string));
    }
  }
  return [...new Set(missing)];
}
export type OfferView = {
  buy: number;
  pay: number;
  group_id?: string | null;
  max_groups?: number | null;
  price_cents: number | null;
  terms: string;
  starts: string;
  ends: string;
};
export type VariantView = {
  id: string;
  name: string;
  pack: string;
  unit: "piece" | "kg";
  price_cents: number | null;
  regular_cents: number | null;
  available: boolean;
  online_limit: number | null;
  offer: OfferView | null;
  unit_price: string;
  in_stock: boolean;
  food: Record<string, any>;
};
export type ProductView = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  description: string;
  category_name: string;
  category_slug: string;
  food: Record<string, any>;
  images: string[];
  variants: VariantView[];
  available: boolean;
};
export function effectivePrice(
  v: any,
  day: string,
): { price_cents: number | null; offer: OfferView | null } {
  if (v.offer?.blocked) return { price_cents: null, offer: null };
  const offer: OfferView | null = v.offer || null;
  const local =
    v.local_cents !== null &&
    v.local_cents !== undefined &&
    (!v.local_until || v.local_until >= day);
  if (local && offer?.price_cents != null && v.local_cents > offer.price_cents)
    return { price_cents: null, offer: null };
  const cents = local
    ? v.local_cents
    : (offer?.price_cents ?? v.regular_cents ?? null);
  return { price_cents: cents, offer };
}
function perUnit(pack: string, unit: string, price: number | null) {
  if (price == null) return "";
  const euro = (n: number) =>
    new Intl.NumberFormat("bg-BG", {
      style: "currency",
      currency: "EUR",
    }).format(n / 100);
  if (unit === "kg") return euro(price) + "/кг";
  const s = pack
    .toLowerCase()
    .replaceAll(",", ".")
    .replace(
      /(\d+)\s*\+\s*(\d+)\s*бр/g,
      (_, a, b) => String(Number(a) + Number(b)) + " бр",
    );
  if (/\d\s*[-/]\s*\d/.test(s)) return "";
  const m = s.match(
    /(?:^|\s)(?:(\d+)\s*[xх×]\s*)?(\d+(?:\.\d+)?)\s*(мл|килограма|кг|грама|г|литра|л|бр)(?=\s|\.|$)/u,
  );
  if (!m) return "";
  const size = Number(m[1] || 1) * Number(m[2]);
  if (!size) return "";
  const u = m[3];
  return (
    euro(
      (price * (u === "мл" || u === "г" || u === "грама" ? 1000 : 1)) / size,
    ) +
    "/" +
    (u === "бр" ? "бр." : u === "л" || u === "мл" || u === "литра" ? "л" : "кг")
  );
}
export const offerJoin = `LEFT JOIN LATERAL (SELECT CASE WHEN EXISTS(SELECT 1 FROM brochure_conflicts b WHERE b.variant_id=v.id AND $1::date BETWEEN b.starts AND b.ends) THEN '{"blocked":true}'::jsonb ELSE
 (SELECT jsonb_build_object('buy',o.buy,'pay',o.pay,'price_cents',o.price_cents,'starts',o.starts,'ends',o.ends,'group_id',o.group_id,'max_groups',o.max_groups,'terms',concat_ws(' · ',nullif(o.terms,''),case when o.group_id is not null then 'Комбинирайте посочените варианти. Безплатни са най-евтините бройки.' end,case when o.max_groups is not null then 'До '||o.max_groups||' групи на поръчка.' end)) FROM offers o WHERE o.variant_id=v.id AND o.approved AND $1::date BETWEEN o.starts AND o.ends ORDER BY o.starts DESC,o.id LIMIT 1) END AS offer) active ON true`;
type Options = {
  q?: string;
  category?: string;
  promo?: boolean;
  available?: boolean;
  sort?: string;
  date?: string;
  limit?: number;
  offset?: number;
  slug?: string;
};
export async function getCatalog(opts: Options = {}): Promise<ProductView[]> {
  const day = opts.date || today();
  const q = (opts.q || "").trim().slice(0, 100);
  const rows = await query(
    `SELECT p.id,p.slug,p.name,p.brand,p.description,p.food,p.available,p.category_id,p.local_settings->'seo' seo,coalesce((p.food->>'ageRestricted')::boolean,false) age_restricted,c.name category_name,c.slug category_slug,
 COALESCE((SELECT jsonb_agg(i.url ORDER BY (i.source='local') DESC,i.sort_order,i.id) FROM images i WHERE i.product_id=p.id),'[]') images,
 (SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('offer',active.offer) ORDER BY v.name,v.id) FROM variants v ${offerJoin} WHERE v.product_id=p.id) variants,
 greatest(similarity(shop_search_key(p.name),shop_search_key($2)),word_similarity(shop_search_key($2),shop_search_key(p.brand||' '||p.name))) relevance
 FROM products p JOIN categories c ON c.id=p.category_id WHERE p.status='published'
 AND (COALESCE((p.food->>'ageRestricted')::boolean,false)=false OR (SELECT value->>'ageEnabled' FROM settings WHERE key='site')='true')
 AND ($3='' OR c.slug=$3) AND ($4='' OR p.slug=$4) AND ($2='' OR position(shop_search_key($2) IN shop_search_key(p.name||' '||p.brand||' '||c.name))>0 OR word_similarity(shop_search_key($2),shop_search_key(p.brand||' '||p.name))>0.40 OR EXISTS(SELECT 1 FROM synonyms s,unnest(s.alternatives||ARRAY[s.term]) AS hit,unnest(s.alternatives||ARRAY[s.term]) AS alt WHERE shop_search_key(hit)=shop_search_key($2) AND position(shop_search_key(alt) IN shop_search_key(p.name||' '||p.brand||' '||c.name))>0))
 ORDER BY relevance DESC,p.name,p.id`,
    [day, q, opts.category || "", opts.slug || ""],
  );
  const products: ProductView[] = rows
    .map((p) => {
      const variants: VariantView[] = (p.variants || []).map((v: any) => {
        const price = effectivePrice(v, day);
        return {
          in_stock: p.available && v.available,
          food: { ...p.food, ...v.food },
          id: v.id,
          name: v.name,
          pack: v.pack,
          unit: v.unit,
          regular_cents: v.regular_cents,
          online_limit: v.online_limit == null ? null : Number(v.online_limit),
          ...price,
          unit_price: perUnit(v.pack, v.unit, price.price_cents),
          available:
            p.available &&
            v.available &&
            price.price_cents !== null &&
            (v.online_limit === null || Number(v.online_limit) > 0),
        };
      });
      return { ...p, variants, available: variants.some((v) => v.available) };
    })
    .filter(
      (p) =>
        (!opts.promo || p.variants.some((v: VariantView) => v.offer)) &&
        (!opts.available || p.available),
    );
  if (opts.sort === "name")
    products.sort((a, b) => a.name.localeCompare(b.name, "bg"));
  if (["price", "price-asc", "price-desc"].includes(opts.sort || "")) {
    const low = (p: ProductView) =>
      Math.min(
        ...p.variants.flatMap((v) =>
          v.price_cents == null ? [] : [v.price_cents],
        ),
      );
    const direction = opts.sort === "price-desc" ? -1 : 1;
    products.sort((a, b) => {
      const first = low(a);
      const second = low(b);
      if (first === second) return 0;
      if (!Number.isFinite(first)) return 1;
      if (!Number.isFinite(second)) return -1;
      return (first - second) * direction;
    });
  }
  const offset = Math.max(0, opts.offset || 0);
  return products.slice(offset, offset + (opts.limit ?? 1000));
}
export async function getProduct(slug: string, date?: string) {
  return (await getCatalog({ slug, date, limit: 1 }))[0] ?? null;
}
export async function getCategories() {
  return query<{ id: string; slug: string; name: string; image_url: string }>(
    `SELECT c.id,c.slug,c.name,c.image_url FROM categories c WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id=c.id AND p.status='published' AND (coalesce(p.food->>'ageRestricted','false')<>'true' OR (SELECT value->>'ageEnabled' FROM settings WHERE key='site')='true')) ORDER BY c.sort_order,c.name`,
  );
}
