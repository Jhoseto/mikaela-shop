// Run after starting the operational shop: node --env-file=.env.local tests/brochure-storefront.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const base = "http://localhost:3000";
const database = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname));
assert.equal(database.pathname, "/mikaela");
const db = new Client({ connectionString: database.href });
await db.connect();
let entries;
try {
  await db.query("BEGIN READ ONLY");
  ({ rows: entries } = await db.query(`
    WITH current_campaign AS (
      SELECT c.id, c.current_batch, c.starts, c.ends, b.source_hash FROM brochure_campaigns c JOIN brochure_batches b ON b.id=c.current_batch
      WHERE (now() AT TIME ZONE 'Europe/Sofia')::date BETWEEN c.starts AND c.ends AND b.status='success'
      ORDER BY c.starts DESC,b.finished_at DESC LIMIT 1
    )
    SELECT p.slug, i.extracted->>'name' AS name, coalesce(cat.slug,'broshura-drugi') AS category,
      i.extracted->>'priceCents' AS cents, (i.extracted->>'localOnly')::boolean AS local_only,
      (p.source_data->'food'->>'ageRestricted')::boolean AS restricted,
      i.extracted->>'imageUrl' AS photo,
      i.extracted->>'snippetUrl' AS snippet, c.id::text AS campaign_id, c.ends::text AS ends
    FROM current_campaign c JOIN brochure_items i ON i.batch_id=c.current_batch JOIN brochure_sources s USING(source_key)
    JOIN variants v ON v.id=s.draft_variant JOIN products p ON p.id=v.product_id
    LEFT JOIN categories cat ON cat.id=(p.source_data->>'category_id')::uuid
    WHERE p.status='draft' AND p.origin='brochure' AND NOT s.excluded AND i.status='review'
      AND NOT EXISTS (SELECT 1 FROM brochure_links l WHERE l.source_key=i.source_key)
    ORDER BY p.slug`));
} finally {
  await db.end();
}
assert.ok(
  entries.length,
  "Тази проверка изисква текуща брошура с още непотвърдени артикули.",
);
const expected = new Map(entries.map((e) => [e.slug, e]));
const orderable =
  process.env.LOCAL_BROCHURE_CAMPAIGN === entries[0].campaign_id;
assert.equal(
  expected.size,
  entries.length,
  "Два различни записа от брошурата споделят един продуктов адрес.",
);

const chrome = await chromium.launch({
  headless: true,
  ...(process.env.TEST_BROWSER_PATH
    ? { executablePath: process.env.TEST_BROWSER_PATH }
    : process.platform === "win32"
      ? { channel: "chrome" }
      : {}),
});
const errors = [];
const context = await chrome.newContext({
  viewport: { width: 1440, height: 960 },
  locale: "bg-BG",
  timezoneId: "Europe/Sofia",
});
context.on("page", (page) =>
  page.on("pageerror", (e) => errors.push(e.message)),
);
await context.route("**/api/orders", (route) => {
  errors.push("Неочаквана заявка за поръчка: " + route.request().method());
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
const slugFrom = (href) =>
  decodeURIComponent(new URL(href, base).pathname.split("/").pop());
const squeeze = (s) => s.replace(/\s+/g, " ").trim();
const money = (cents) =>
  squeeze(
    new Intl.NumberFormat("bg-BG", {
      style: "currency",
      currency: "EUR",
    }).format(Number(cents) / 100),
  );
const dateLabel = (date) =>
  squeeze(
    new Intl.DateTimeFormat("bg-BG", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Sofia",
    }).format(new Date(date + "T12:00:00Z")),
  );
const cardLinks = () =>
  page
    .locator(".product-card h3 a")
    .evaluateAll((nodes) => nodes.map((a) => a.href));
async function open(path) {
  const response = await page.goto(new URL(path, base).href, {
    waitUntil: "domcontentloaded",
  });
  assert.equal(response?.status(), 200, path);
}
async function imagePath(image) {
  await image.scrollIntoViewIfNeeded();
  return image.evaluate(async (el) => {
    await el.decode();
    if (!el.naturalWidth || !el.naturalHeight)
      throw Error("Незаредена снимка: " + el.src);
    const box = el.parentElement.getBoundingClientRect();
    const photo = el.getBoundingClientRect();
    if (
      photo.left < box.left - 1 ||
      photo.top < box.top - 1 ||
      photo.right > box.right + 1 ||
      photo.bottom > box.bottom + 1
    )
      throw Error(
        "Част от снимката излиза извън продуктовата рамка: " + el.src,
      );
    return new URL(el.currentSrc).pathname;
  });
}
async function allPages(path, inspectCards = false) {
  const slugs = new Set(),
    visited = new Set();
  while (path) {
    assert.ok(!visited.has(path), "Цикъл в страницирането: " + path);
    visited.add(path);
    await open(path);
    if (inspectCards && visited.size === 1) {
      await page
        .locator(".product-card .product-image img")
        .first()
        .evaluate((image) => image.decode());
      await page.evaluate(() => document.fonts.ready);
      await mkdir("var/qa", { recursive: true });
      await page.screenshot({ path: "var/qa/brochure-catalog.png" });
    }
    for (const card of await page.locator(".product-card").all()) {
      const slug = slugFrom(await card.locator("h3 a").getAttribute("href"));
      assert.ok(!slugs.has(slug), "Повторена карта: " + slug);
      slugs.add(slug);
      const entry = expected.get(slug);
      if (inspectCards && entry) {
        assert.ok(
          squeeze(await card.locator(".price-row strong").innerText()).includes(
            money(entry.cents),
          ),
          entry.name,
        );
        if (!orderable)
          assert.match(
            await card.innerText(),
            /само за разглеждане/i,
            entry.name,
          );
        if (orderable)
          await card.locator("button.add-button:enabled").waitFor();
        assert.equal(
          await card.locator("button.add-button:enabled").count(),
          orderable ? 1 : 0,
          entry.name,
        );
        const photo = await imagePath(card.locator(".product-image img"));
        assert.equal(
          photo.replace(/-card\.webp$/, ".webp"),
          entry.photo,
          entry.name,
        );
      }
    }
    const next = page.getByRole("link", { name: "Следваща" });
    path = (await next.count()) ? await next.getAttribute("href") : null;
  }
  return { slugs, pages: visited.size };
}
try {
  await open("/");
  assert.ok(
    (await cardLinks()).some((href) => expected.has(slugFrom(href))),
    "Няма предложение от брошурата на началната страница.",
  );
  const catalog = await allPages("/produkti", true);
  const promotions = await allPages("/promocii");
  const available = await allPages("/produkti?available=1");
  for (const entry of entries) {
    assert.ok(
      catalog.slugs.has(entry.slug),
      "Липсва в каталога: " + entry.name,
    );
    assert.ok(
      promotions.slugs.has(entry.slug),
      "Липсва в промоциите: " + entry.name,
    );
    assert.ok(
      available.slugs.has(entry.slug) === orderable,
      "Достъпност в каталога: " + entry.name,
    );
    await open("/produkti/" + encodeURIComponent(entry.slug));
    assert.equal(
      squeeze(await page.locator("main h1").innerText()),
      squeeze(entry.name),
    );
    assert.ok(
      squeeze(await page.locator(".detail-price").innerText()).includes(
        money(entry.cents),
      ),
      entry.name,
    );
    assert.equal(
      await imagePath(page.locator(".detail-image img")),
      entry.photo,
      entry.name,
    );
    const promotion = squeeze(await page.locator(".detail-promo").innerText());
    assert.ok(promotion.includes(dateLabel(entry.ends)), entry.name);
    if (entry.local_only)
      assert.ok(promotion.includes("определени обекти"), entry.name);
    if (entry.restricted)
      assert.match(
        await page.locator(".detail-info").innerText(),
        /възрастово ограничение/i,
        entry.name,
      );
    if (orderable)
      await page.locator(".detail-info button.add-button:enabled").waitFor();
    assert.equal(
      await page.locator(".detail-info button.add-button:enabled").count(),
      orderable ? 1 : 0,
      entry.name,
    );
    const offers = await page
      .locator("script[type='application/ld+json']")
      .evaluateAll((nodes) =>
        nodes.flatMap((n) => JSON.parse(n.textContent).offers ?? []),
      );
    assert.equal(
      offers.length,
      0,
      "Публично обещание за продажба: " + entry.name,
    );
  }
  const categories = [
    ...new Set(entries.map((e) => e.category).filter(Boolean)),
  ];
  for (const category of categories) {
    const group = await allPages("/kategorii/" + encodeURIComponent(category));
    for (const entry of entries.filter((e) => e.category === category))
      assert.ok(group.slugs.has(entry.slug), entry.name);
  }
  const sample = entries[0];
  await open("/tarsene?q=" + encodeURIComponent(sample.name));
  assert.ok(
    (await cardLinks()).some((href) => slugFrom(href) === sample.slug),
    "Търсенето не открива " + sample.name,
  );
  const privateResponse = await context.request.get(
    new URL(sample.snippet, base).href,
  );
  assert.equal(
    privateResponse.status(),
    404,
    "Служебният откъс от брошурата е публичен.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await open("/produkti");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  for (const thumbnail of await page.locator(".product-image img").all())
    await imagePath(thumbnail);
  assert.deepEqual(errors, []);
  console.log(
    `Проверени ${entries.length} публични продукта, ${catalog.pages} каталожни страници, ${categories.length} категории. Снимките, цените, сроковете и ограниченията за поръчване съвпадат.`,
  );
  const demo = await fetch("http://localhost:3100/api/health", {
    signal: AbortSignal.timeout(1200),
  }).catch(() => null);
  if (demo?.ok) {
    await open("http://localhost:3100/produkti");
    await page
      .locator(".product-card button[aria-label^='Добави ']:enabled")
      .first()
      .waitFor();
    console.log(
      "Демонстрацията запазва поръчването на вече одобрените продукти.",
    );
  }
} finally {
  await chrome.close();
}
