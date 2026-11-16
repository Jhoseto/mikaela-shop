import "server-only";
import { cache } from "react";
import { query } from "@/db";
import {
  defaultCarousel,
  type CarouselConfig,
  type CarouselProductOption,
  type CarouselRecord,
  type CarouselSlide,
} from "@/commerce/carousel";
import {
  currentBrochureBatch,
  currentBrochureListings,
} from "@/importer/public-listings";
import type { HeroSlide } from "./brochure-hero";
import { shopProducts, shopSettings } from "./data";
import {
  priceText,
  productHref,
  shortDate,
  type ShopProduct,
  type ShopSettings,
  type ShopVariant,
} from "./model";

type Story = Pick<CarouselSlide, "title" | "accent" | "theme"> & {
  match: RegExp;
  image?: string;
  imageAlt?: string;
};
const stories: Story[] = [
  {
    match: /мандраджийско сирене/i,
    title: "Сирене за",
    accent: "салатата.",
    theme: "table",
    image: "/design/campaign-table.webp",
    imageAlt:
      "Две поколения заедно приготвят салата на слънчева кухненска маса.",
  },
  {
    match: /десертен портокал|десертни портокали/i,
    title: "Десертни",
    accent: "портокали.",
    theme: "citrus",
    image: "/design/campaign-citrus.webp",
    imageAlt: "Усмихната жена с пресни портокали.",
  },
  {
    match: /круш[аи].*лукас/i,
    title: "Круши",
    accent: "Лукас.",
    theme: "market",
    image: "/design/campaign-market.webp",
    imageAlt: "Продавач на пазара подава круши.",
  },
  {
    match: /dolce gusto|кафе капсули/i,
    title: "Кафе на",
    accent: "капсули.",
    theme: "coffee",
  },
  {
    match: /сладолед/i,
    title: "Сладолед за",
    accent: "десерт.",
    theme: "dessert",
  },
];

export const carouselCatalog = cache(async () => {
  const [products, variants] = await Promise.all([
    shopProducts({ limit: Number.MAX_SAFE_INTEGER }),
    query<{
      variant_id: string;
    }>(`SELECT variant_id FROM (${currentBrochureListings}) list
      UNION SELECT o.variant_id FROM offers o JOIN (${currentBrochureBatch}) campaign ON campaign.id=o.campaign_id
      WHERE o.approved AND (now() AT TIME ZONE 'Europe/Sofia')::date BETWEEN o.starts AND o.ends`),
  ]);
  return { products, flyerIds: new Set(variants.map((v) => v.variant_id)) };
});
type HeroCatalog = Awaited<ReturnType<typeof carouselCatalog>>;

const withPrice = (v: ShopVariant) =>
  v.price != null && (v.available || v.listingOnly === true);
function displayVariant(product: ShopProduct, preferred?: string) {
  return (
    product.variants.find((v) => v.id === preferred && withPrice(v)) ??
    product.variants.find((v) => v.available && withPrice(v)) ??
    product.variants.find(withPrice)
  );
}

function automaticSlides(
  { products, flyerIds }: HeroCatalog,
  settings: ShopSettings,
): CarouselSlide[] {
  const candidates = products.flatMap((product) => {
    if (product.restricted || !product.images.length) return [];
    const variant = product.variants.find(
      (v) => flyerIds.has(v.id) && v.offer && !v.restricted && withPrice(v),
    );
    return variant ? [{ product, variant }] : [];
  });
  const slides: CarouselSlide[] = [];
  const selected = new Set<string>();
  function add(
    { product, variant }: (typeof candidates)[number],
    story?: Story,
  ) {
    slides.push({
      id: variant.id,
      kind: "product",
      productId: product.id,
      enabled: true,
      title: story?.title || product.category.name,
      accent: story?.accent || "",
      detail: "",
      image: story?.image || "",
      imageAlt: story?.imageAlt || "",
      theme: story?.theme || (slides.length % 2 === 0 ? "coffee" : "dessert"),
      button: "Виж продукта",
      href: "",
    });
    selected.add(product.id);
  }
  for (const story of stories) {
    const item = candidates.find(
      ({ product }) =>
        !selected.has(product.id) && story.match.test(product.name),
    );
    if (item) add(item, story);
  }
  for (const item of candidates) {
    if (slides.length >= 5) break;
    if (!selected.has(item.product.id)) add(item);
  }

  const first = slides[0];
  if (!first)
    return [
      {
        id: "84eecc6a-9504-4def-b462-829a41a2e73f",
        kind: "custom",
        productId: "",
        enabled: true,
        title: settings.heroTitle || "Моят Магазин",
        accent: settings.heroTitle ? "" : "Микаела.",
        detail: settings.heroText || "",
        image: settings.heroImage || "/design/campaign-table.webp",
        imageAlt: settings.heroImage ? "" : stories[0].imageAlt!,
        theme: "table",
        href: "/produkti",
        button: settings.heroButton || "Към каталога",
      },
    ];
  if (settings.heroTitle && settings.heroTitle !== "Предложения от брошурата") {
    first.title = settings.heroTitle;
    first.accent = "";
  }
  if (settings.heroImage) {
    first.image = settings.heroImage;
    first.imageAlt = "";
  }
  if (settings.heroText) first.detail = settings.heroText;
  if (settings.heroButton && settings.heroButton !== "Започни да пазаруваш") {
    first.button = settings.heroButton;
    first.href = "/produkti";
  }
  return slides;
}

function productDescription(product: ShopProduct, variant: ShopVariant) {
  const raw = product.name.split("•")[0].trim();
  const name =
    raw && raw === raw.toLocaleUpperCase("bg-BG")
      ? raw[0] + raw.slice(1).toLocaleLowerCase("bg-BG")
      : raw;
  const pack =
    variant.pack && !name.toLowerCase().includes(variant.pack.toLowerCase())
      ? " · " + variant.pack
      : "";
  return { name, detail: name + pack };
}

function renderSlides(
  slides: CarouselSlide[],
  catalog: HeroCatalog,
  dates: string,
  automatic: boolean,
): HeroSlide[] {
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  return slides.flatMap((s): HeroSlide[] => {
    if (!s.enabled) return [];
    const base = {
      id: s.id,
      accent: s.accent,
      theme: s.theme,
      photo: s.image || undefined,
      photoAlt: s.imageAlt,
    };
    if (s.kind === "custom")
      return [
        {
          ...base,
          title: s.title,
          detail: s.detail,
          product: s.title,
          href: s.href,
          button: s.button || "Виж повече",
          eyebrow: "",
        },
      ];
    const product = byId.get(s.productId);
    const variant = product && displayVariant(product, s.id);
    if (!product || !variant) return [];
    const { name, detail } = productDescription(product, variant);
    const offer = variant.offer;
    const isFlyer = !!offer && catalog.flyerIds.has(variant.id);
    const conditions: string[] = [];
    if (product.restricted || variant.restricted) conditions.push("18+");
    if (offer?.buy && offer.pay && offer.buy > offer.pay)
      conditions.push(`Вземи ${offer.buy}, плати ${offer.pay}`);
    if (
      offer?.label &&
      !["Цена от брошурата", "Промоционална цена"].includes(offer.label) &&
      !conditions.includes(offer.label)
    )
      conditions.push(offer.label);
    const validDates =
      offer?.starts && offer.ends
        ? shortDate(offer.starts) + " – " + shortDate(offer.ends, true)
        : "";
    return [
      {
        ...base,
        title: s.title || name,
        product: name,
        detail:
          automatic && s.detail
            ? s.detail + " · " + detail
            : s.detail || detail,
        href: automatic && s.href ? s.href : productHref(product.slug),
        button: s.button || "Виж продукта",
        packshot: product.images[0],
        price: priceText(variant),
        conditions: conditions.join(" · "),
        priceLabel: offer && !isFlyer ? "Промоционална цена" : "",
        eyebrow: isFlyer ? dates : validDates,
      },
    ];
  });
}

export async function publicCarousel(
  catalog: HeroCatalog,
  settings: ShopSettings,
  dates: string,
) {
  const [row] = await query<{ config: CarouselConfig | null }>(
    "SELECT value->'published' AS config FROM settings WHERE key='heroCarousel'",
  );
  const config = row?.config ?? defaultCarousel;
  const automatic = config.mode === "auto";
  return {
    slides: renderSlides(
      automatic ? automaticSlides(catalog, settings) : config.slides,
      catalog,
      dates,
      automatic,
    ),
    autoPlay: config.autoPlay,
    intervalMs: config.intervalMs,
  };
}

export async function carouselEditorData() {
  const [catalog, settings, [row]] = await Promise.all([
    carouselCatalog(),
    shopSettings(),
    query<{ value: CarouselRecord }>(
      "SELECT value FROM settings WHERE key='heroCarousel'",
    ),
  ]);
  const products: CarouselProductOption[] = catalog.products
    .flatMap((p) => {
      const v = displayVariant(p);
      return v
        ? [
            {
              id: p.id,
              name: p.name,
              price: priceText(v),
              href: productHref(p.slug),
              image: p.images[0] || "",
            },
          ]
        : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "bg"));
  return {
    initial: row?.value.draft ?? row?.value.published ?? defaultCarousel,
    products,
    revision: row?.value.revision ?? 0,
    version: row?.value.version ?? 0,
    automatic: automaticSlides(catalog, settings),
  };
}
