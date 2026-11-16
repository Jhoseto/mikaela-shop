import "server-only";
import { cache } from "react";
import { query } from "@/db";
import {
  getCatalog,
  getCategories,
  getPage,
  getProduct,
  getSettings,
} from "@/commerce/catalog";
import { getCurrentBrochure } from "@/importer/public";
import {
  type ShopCategory,
  type ShopPage,
  type ShopProduct,
  type ShopSettings,
} from "./model";

type Raw = Record<string, any>;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const publicFoodFields = [
  "ingredients",
  "allergens",
  "net",
  "storage",
  "nutrition",
  "operator",
  "origin",
  "instructions",
];
function publicFood(
  food: Record<string, unknown> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(food ?? {})
      .filter(
        ([k, v]) => publicFoodFields.includes(k) && typeof v === "string" && v,
      )
      .map(([k, v]) => [k, String(v)]),
  );
}
function product(row: Raw, detailed = false): ShopProduct {
  return {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    description: detailed ? row.description : undefined,
    category: {
      id: row.category_id ?? row.category_slug,
      slug: row.category_slug,
      name: row.category_name,
    },
    images: (row.images || []).filter((i: unknown) => typeof i === "string"),
    details: detailed ? publicFood(row.food) : {},
    restricted: Boolean(row.age_restricted || row.food?.ageRestricted),
    seo: row.seo,
    variants: (row.variants || []).map((v: Raw) => ({
      id: String(v.id),
      name: text(v.name),
      pack: text(v.pack),
      unit: v.unit,
      price: v.price_cents == null ? null : Number(v.price_cents),
      listingOnly: Boolean(v.listingOnly ?? row.listingOnly),
      localBrochureOrder: Boolean(v.localBrochureOrder),
      requiresVariantChoice: Boolean(v.requiresVariantChoice),
      missingFoodLabel: Boolean(v.localBrochureOrder && ["packaged", "unpackaged"].includes(v.food?.type) && !v.food?.source),
      available: Boolean(
        !(v.listingOnly ?? row.listingOnly) &&
        v.available &&
        row.available !== false,
      ),
      inStock: typeof v.in_stock === "boolean" ? v.in_stock : undefined,
      unitPrice: text(v.unit_price),
      details: detailed && v.food ? publicFood(v.food) : undefined,
      restricted: Boolean(
        v.food?.ageRestricted || row.age_restricted || row.food?.ageRestricted,
      ),
      regular: v.regular_cents ?? undefined,
      step: v.unit === "kg" ? Math.min(0.1, Number(v.online_limit) || 0.1) : 1,
      max: v.online_limit == null ? undefined : Number(v.online_limit),
      offer: v.offer
        ? {
            label:
              text(v.offer.terms) ||
              ((v.localBrochureOrder || (v.listingOnly ?? row.listingOnly))
                ? "Цена от брошурата"
                : "Промоционална цена"),
            ends: v.offer.ends,
            starts: v.offer.starts,
            buy: v.offer.buy,
            pay: v.offer.pay,
            group_id: v.offer.group_id,
            max_groups: v.offer.max_groups,
          }
        : undefined,
    })),
  };
}
export const shopSettings = cache(async (): Promise<ShopSettings> => {
  const s: Raw = await getSettings();
  return {
    name: s.name || "Моят Магазин Микаела",
    phone: s.phone,
    email: s.email,
    address: [s.city, s.address].filter(Boolean).join(", "),
    hours: s.hours,
    logo: s.logo,
    shopPhoto: s.photo,
    heroTitle: s.hero?.title,
    heroText: s.hero?.subtitle,
    heroImage: s.hero?.image,
    heroButton: s.hero?.button,
    featured: s.featuredIds || [],
    company: s.company,
    companyId: s.companyId,
    siteUrl: s.baseUrl,
    enabled: Boolean(s.ordersOpen),
    demo: Boolean(s.demo),
    localBrochureOrdering: Boolean(s.localBrochureOrdering),
    card: Boolean(s.cardEnabled),
    termsVersion: String(s.termsVersion || ""),
    weightTolerancePercent: Number(s.weightTolerance || 0),
    promoBasis: s.promoBasis,
  };
});
export const shopCategories = cache(async (): Promise<ShopCategory[]> =>
  (await getCategories()).map((c: Raw) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    image: c.image_url,
  })),
);
export const shopProduct = cache(async (slug: string) => {
  const p = await getProduct(slug);
  return p ? product(p, true) : null;
});
export async function shopProducts(
  options: Parameters<typeof getCatalog>[0] = {},
) {
  return (await getCatalog(options)).map((row) => product(row));
}
export async function featuredProducts(ids: string[]) {
  if (!ids.length) return [];
  const slugs = await query<{ slug: string }>(
    "SELECT slug FROM products WHERE id=ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)",
    [ids],
  );
  const rows = await Promise.all(slugs.map((row) => shopProduct(row.slug)));
  return rows.filter((p): p is ShopProduct => p !== null);
}
export const shopBrochure = cache(async () => {
  const c = await getCurrentBrochure();
  return c
    ? {
        title: "Актуална брошура",
        starts: c.starts,
        ends: c.ends,
        pdf: c.pdfUrl,
        cover: c.coverUrl,
      }
    : null;
});
export const shopPage = cache(
  async (slug: string): Promise<ShopPage | null> => {
    const p: Raw | null = await getPage(slug);
    return p
      ? { title: p.title, body: p.body, image: p.image, version: p.version }
      : null;
  },
);
export function origin(settings: ShopSettings) {
  try {
    const u = new URL(settings.siteUrl || "");
    return ["https:", "http:"].includes(u.protocol) ? u.origin : undefined;
  } catch {
    return undefined;
  }
}
export function jsonld(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
