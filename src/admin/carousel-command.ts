import type { PoolClient } from "pg";
import { z } from "zod";
import { getCatalog } from "@/commerce/catalog";
import {
  carouselThemes,
  type CarouselConfig,
  type CarouselRecord,
} from "@/commerce/carousel";
import { InputIssue } from "./http";
import { integer, one, type Values } from "./input";

function shopLink(value: string) {
  if (!value) return true;
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\s\u0000-\u001f]/u.test(value)
  )
    return false;
  try {
    const url = new URL(value, "https://shop.invalid");
    return (
      url.origin === "https://shop.invalid" && !url.pathname.startsWith("//")
    );
  } catch {
    return false;
  }
}

const slideSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["product", "custom"]),
  enabled: z.boolean(),
  productId: z.union([z.uuid(), z.literal("")]),
  title: z.string().trim().max(150),
  accent: z.string().trim().max(100),
  detail: z.string().trim().max(600),
  button: z.string().trim().max(70),
  image: z
    .string()
    .trim()
    .max(1000)
    .refine(
      (v) =>
        !v ||
        (/^\/(?:media|design)\/[a-zA-Z0-9_./-]+$/u.test(v) &&
          !v.includes("..") &&
          !v.includes("//")),
      "Избери снимка от магазина или качи нова.",
    ),
  imageAlt: z.string().trim().max(250),
  theme: z.enum(carouselThemes),
  href: z
    .string()
    .trim()
    .max(1000)
    .refine(
      shopLink,
      "Въведи вътрешен адрес, който започва с една наклонена черта.",
    ),
});

const configSchema = z.object({
  mode: z.enum(["auto", "manual"]),
  autoPlay: z.boolean(),
  intervalMs: z.number().int().min(3000).max(20000),
  slides: z.array(slideSchema).max(5),
});

function readConfig(raw: unknown): CarouselConfig {
  let value: unknown;
  try {
    value = JSON.parse(String(raw));
  } catch {
    throw new InputIssue("Каруселът съдържа невалидни настройки.");
  }
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new InputIssue(
      issue.code === "custom"
        ? issue.message
        : "Провери полетата на слайдовете и интервала между тях (3–20 секунди).",
    );
  }
  const ids = parsed.data.slides.map((s) => s.id);
  if (new Set(ids).size !== ids.length)
    throw new InputIssue("Всеки слайд трябва да има собствен запис.");
  return parsed.data;
}

async function validatePublication(config: CarouselConfig, client: PoolClient) {
  if (config.mode !== "manual") return;
  const products = new Set<string>();
  for (const [index, slide] of config.slides.entries()) {
    if (!slide.enabled) continue;
    if (slide.kind === "product") {
      if (!slide.productId)
        throw new InputIssue(`Избери продукт за слайд ${index + 1}.`);
      products.add(slide.productId);
    } else if (!slide.title || !slide.href) {
      throw new InputIssue(`Попълни заглавие и адрес за слайд ${index + 1}.`);
    }
  }
  if (!products.size) return;
  const rows = await getCatalog({ ids: [...products] }, client);
  for (const row of rows) {
    if (
      row.variants.some(
        (v) => v.price_cents != null && (v.available || v.listingOnly),
      )
    )
      products.delete(row.id);
  }
  if (products.size)
    throw new InputIssue(
      "Избран продукт вече няма публична цена или е недостъпен. Смени го или скрий слайда.",
    );
}

export async function saveCarousel(c: PoolClient, data: Values) {
  const revision = integer(data, "revision", 0, Number.MAX_SAFE_INTEGER);
  const publish = one(data, "operation", ["save", "publish"]) === "publish";
  const config = readConfig(data.config);
  await c.query(
    "INSERT INTO settings(key,value) VALUES('heroCarousel','{}') ON CONFLICT DO NOTHING",
  );
  const row = (
    await c.query<{ value: Partial<CarouselRecord> }>(
      "SELECT value FROM settings WHERE key='heroCarousel' FOR UPDATE",
    )
  ).rows[0].value;
  if ((row.revision ?? 0) !== revision)
    throw new InputIssue(
      "Каруселът е променен в друг прозорец. Презареди преди запис.",
    );
  if (publish) await validatePublication(config, c);
  const result = await c.query<{ version: number }>(
    `
    UPDATE settings SET value = jsonb_build_object(
      'revision', $1::integer, 'draft', $2::jsonb,
      'published', CASE WHEN $3 THEN $2::jsonb ELSE value->'published' END,
      'version', coalesce((value->>'version')::integer,0) +
        CASE WHEN $3 AND value->'published' IS DISTINCT FROM $2::jsonb THEN 1 ELSE 0 END
    ) WHERE key='heroCarousel' RETURNING (value->>'version')::integer AS version`,
    [revision + 1, config, publish],
  );
  return {
    revision: revision + 1,
    version: result.rows[0].version,
    message: publish
      ? "Каруселът е публикуван."
      : "Черновата на карусела е запазена.",
  };
}
