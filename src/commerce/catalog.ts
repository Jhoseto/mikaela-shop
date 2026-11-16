import { query } from "@/db";
import type { PoolClient } from "pg";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  currentBrochureListings,
  datedBrochureListings,
} from "@/importer/public-listings";
import {
  activeLocalBrochure,
  localBrochureCampaign,
  localTermsSlug,
} from "./local-brochure";
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
  localOrdersOpen: false,
  localBrochureOrdering: false,
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
  const active = await activeLocalBrochure();
  const termsSlug = active ? localTermsSlug : "obshti-usloviya";
  const result = await db.execute(
    sql`SELECT value,(SELECT version FROM pages WHERE slug=${termsSlug} AND published IS NOT NULL) AS legal_version FROM settings WHERE key='site'`,
  );
  const r = result.rows[0] as any;
  return {
    ...siteDefaults,
    ...r?.value,
    ordersOpen: active
      ? r?.value?.localOrdersOpen === true
      : r?.value?.ordersOpen === true,
    localBrochureOrdering: !!active,
    termsVersion: Number(r?.legal_version || 0),
    hero: { ...siteDefaults.hero, ...r?.value?.hero },
  };
}
export async function getPage(slug: string) {
  const pageSlug =
    slug === "obshti-usloviya" && (await activeLocalBrochure())
      ? localTermsSlug
      : slug;
  const [r] = await query(
    "SELECT published,version FROM pages WHERE slug=$1 AND published IS NOT NULL",
    [pageSlug],
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
  listingOnly: boolean;
  localBrochureOrder: boolean;
  requiresVariantChoice: boolean;
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
  listingOnly: boolean;
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
  ids?: string[];
};
const publishedCatalogProduct = `p.status='published' AND (
  coalesce((p.food->>'ageRestricted')::boolean,false)=false
  OR (SELECT value->>'ageEnabled' FROM settings WHERE key='site')='true')`;

// Query and product tokens use the same Bulgarian transliteration as the catalog index.
const searchWords = (expression: string) =>
  `trim(regexp_replace(shop_search_key(${expression}), '[^[:alnum:]]+', ' ', 'g'))`;

export async function getCatalog(opts: Options = {}, client?: PoolClient): Promise<ProductView[]> {
  const day = opts.date || today();
  const q = (opts.q || "").trim().slice(0, 100);
  const statement = `WITH brochure_listings AS (${datedBrochureListings("$5")}), catalog AS (
      SELECT p.id,p.slug,p.name,p.brand,p.description,p.food,p.available,c.id::text AS category_id,
        p.local_settings->'seo' AS seo,coalesce((p.food->>'ageRestricted')::boolean,false) AS age_restricted,
        c.name AS category_name,c.slug AS category_slug,false AS listing_only,NULL::int AS page,NULL::int AS ordinal,
        coalesce((SELECT jsonb_agg(i.url ORDER BY (i.source='local') DESC,i.sort_order,i.id) FROM images i WHERE i.product_id=p.id),'[]') AS images,
        (SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('offer',active.offer) ORDER BY v.name,v.id)
         FROM variants v ${offerJoin} WHERE v.product_id=p.id) AS variants
      FROM products p JOIN categories c ON c.id=p.category_id WHERE ${publishedCatalogProduct}
      UNION ALL
      SELECT b.product_id,p.slug,b.name,b.brand,b.description,b.public_food,b.local_brochure_order AND b.stock_available,coalesce(c.id::text,'broshura-drugi'),
        NULL::jsonb,b.age_restricted,coalesce(c.name,'Други предложения'),coalesce(c.slug,'broshura-drugi'),NOT b.local_brochure_order,b.page,b.ordinal,
        CASE WHEN b.image_url IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(b.image_url) END,
        jsonb_build_array(jsonb_build_object('id',b.variant_id,'name',b.name,'pack',b.pack,'unit',b.unit,
          'available',b.local_brochure_order AND b.stock_available,'online_limit',CASE WHEN b.local_brochure_order THEN b.online_limit END,
          'localBrochureOrder',b.local_brochure_order,'requiresVariantChoice',b.local_brochure_order AND b.requires_variant_choice,'offer',b.offer))
      FROM brochure_listings b JOIN products p ON p.id=b.product_id LEFT JOIN categories c ON c.id=b.category_id
    )
    SELECT catalog.* FROM catalog
    CROSS JOIN (SELECT ${searchWords("$2::text")} AS term) needle
    CROSS JOIN LATERAL (SELECT ${searchWords("name")} AS title,
      ${searchWords("brand")} AS maker, ${searchWords("category_name")} AS category) words
    CROSS JOIN LATERAL (SELECT concat_ws(' ',words.title,words.maker,words.category) AS all_words) haystack
    CROSS JOIN LATERAL (SELECT CASE
      WHEN $2='' THEN 0
      WHEN needle.term='' THEN -1
      WHEN needle.term IN (words.title,words.maker) THEN 6
      WHEN strpos(' '||words.title||' ',' '||needle.term||' ')>0 THEN 5
      WHEN strpos(' '||words.title,' '||needle.term)>0 OR starts_with(words.maker,needle.term) THEN 4
      WHEN NOT EXISTS (SELECT 1 FROM unnest(string_to_array(needle.term,' ')) t(word)
        WHERE strpos(' '||haystack.all_words,' '||t.word)=0) THEN 3
      WHEN EXISTS (SELECT 1 FROM synonyms s, unnest(s.alternatives||ARRAY[s.term]) AS hit,
        unnest(s.alternatives||ARRAY[s.term]) AS alt WHERE ${searchWords("hit")}=needle.term
        AND strpos(haystack.all_words,${searchWords("alt")})>0) THEN 3
      WHEN length(needle.term)>=3 AND strpos(haystack.all_words,needle.term)>0 THEN 2
      WHEN length(needle.term)>=4 AND NOT EXISTS (
        SELECT 1 FROM unnest(string_to_array(needle.term,' ')) t(word)
        WHERE strpos(' '||haystack.all_words,' '||t.word)=0
          AND (length(t.word)<4 OR strict_word_similarity(t.word,words.title||' '||words.maker)
            < CASE WHEN length(t.word)>=5 THEN 0.40 ELSE 0.55 END)
      ) THEN 1
      ELSE -1 END AS tier) score
    WHERE ($3='' OR category_slug=$3) AND ($4='' OR slug=$4)
      AND ($6::uuid[] IS NULL OR id=ANY($6::uuid[]))
      AND score.tier>=0
    ORDER BY score.tier DESC,
      CASE WHEN $2<>'' THEN word_similarity(needle.term,words.title) END DESC,
      listing_only,page,ordinal,name,id LIMIT $7`;
  // Relevance-only suggestions can be limited before loading the catalog into memory.
  // Availability, offer and price filters below need the full matching set.
  const canLimitInSql = q && !opts.available && !opts.promo && !opts.offset &&
    (!opts.sort || opts.sort === "relevance");
  const limit = canLimitInSql && typeof opts.limit === "number" && Number.isSafeInteger(opts.limit) && opts.limit >= 0
    ? opts.limit : null;
  const params = [day, q, opts.category || "", opts.slug || "", localBrochureCampaign(), opts.ids ?? null, limit];
  const rows = client ? (await client.query(statement, params)).rows : await query(statement, params);
  const products: ProductView[] = rows
    .map((p) => {
      const variants: VariantView[] = (p.variants || []).map((v: any) => {
        const price = effectivePrice(v, day);
        return {
          listingOnly: p.listing_only,
          localBrochureOrder: Boolean(v.localBrochureOrder),
          requiresVariantChoice: Boolean(v.requiresVariantChoice),
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
      return {
        ...p,
        listingOnly: p.listing_only,
        variants,
        available: variants.some((v) => v.available),
      };
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
    `WITH brochure_listings AS (${currentBrochureListings}), visible_categories AS (
      SELECT c.id::text,c.slug,c.name,c.image_url,c.sort_order FROM categories c
      WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id=c.id AND ${publishedCatalogProduct})
         OR EXISTS (SELECT 1 FROM brochure_listings b WHERE b.category_id=c.id)
      UNION ALL SELECT 'broshura-drugi','broshura-drugi','Други предложения','',2147483647
      WHERE EXISTS (SELECT 1 FROM brochure_listings WHERE category_id IS NULL)
    ) SELECT id,slug,name,image_url FROM visible_categories ORDER BY sort_order,name`,
  );
}
