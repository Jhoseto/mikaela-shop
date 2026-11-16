export type ShopCategory = {
  id: string;
  slug: string;
  name: string;
  image?: string | null;
};
export type ShopOffer = {
  label: string;
  ends: string;
  buy?: number;
  pay?: number;
  starts?: string;
  group_id?: string | null;
  max_groups?: number | null;
};
export type ShopVariant = {
  id: string;
  name: string;
  pack: string;
  unit: "piece" | "kg";
  price: number | null;
  available: boolean;
  inStock?: boolean;
  unitPrice?: string;
  regular?: number;
  details?: Record<string, string>;
  restricted?: boolean;
  offer?: ShopOffer;
  step: number;
  max?: number;
};
export type ShopProduct = {
  id: string;
  slug: string;
  name: string;
  brand?: string;
  description?: string;
  category: ShopCategory;
  images: string[];
  variants: ShopVariant[];
  details: Record<string, string>;
  restricted?: boolean;
  seo?: { title?: string; description?: string };
};
export type ShopZone = {
  id: string;
  name: string;
  fee: number;
  minimum: number;
  freeFrom?: number | null;
};
export type ShopSlot = { id: string; date: string; start: string; end: string };
export type ShopCampaign = {
  title: string;
  starts: string;
  ends: string;
  pdf: string;
};
export type ShopPage = {
  title: string;
  body: string;
  image?: string;
  version?: string;
};
export type ShopSettings = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  hours?: string;
  logo?: string;
  shopPhoto?: string;
  heroImage?: string;
  heroTitle?: string;
  heroText?: string;
  heroButton?: string;
  featured?: string[];
  promoIds?: string[];
  categories?: string[];
  company?: string;
  companyId?: string;
  siteUrl?: string;
  enabled: boolean;
  demo: boolean;
  card: boolean;
  termsVersion?: string;
  weightTolerancePercent?: number;
  promoBasis?: string;
};
export type BasketLine = {
  variantId: string;
  productSlug: string;
  title: string;
  variantName: string;
  pack: string;
  unit: "kg" | "piece";
  step: number;
  quantity: number;
  price: number;
  max?: number;
  image?: string;
  regular?: number;
  offer?: ShopOffer;
  substitution: "skip" | "call";
  note: string;
};
export const money = (cents: number) =>
  new Intl.NumberFormat("bg-BG", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
export const amount = (value: number) =>
  new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 3 }).format(value);
export function shortDate(date: string, year = false) {
  if (!date) return "";
  const stamp = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date + "T12:00:00+02:00"
    : date;
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.valueOf())) return "";
  return new Intl.DateTimeFormat("bg-BG", {
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" as const } : {}),
    timeZone: "Europe/Sofia",
  }).format(parsed);
}
export function priceText(variant: ShopVariant) {
  if (variant.price == null) return "Очаква цена";
  return money(variant.price) + (variant.unit === "kg" ? " / кг" : "");
}
export const infoPages = {
  dostavka: "Доставка и плащане",
  "za-magazina": "За магазина",
  kontakti: "Контакти",
  "obshti-usloviya": "Общи условия",
  poveritelnost: "Поверителност и бисквитки",
  "otkaz-i-reklamacii": "Отказ и рекламации",
} as const;
export const productHref = (slug: string) =>
  "/produkti/" + encodeURIComponent(slug);
export const categoryHref = (slug: string) =>
  "/kategorii/" + encodeURIComponent(slug);
export function routeSlug(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
