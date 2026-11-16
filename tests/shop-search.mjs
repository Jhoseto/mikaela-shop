// Run against the local November brochure shop: node tests/shop-search.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";

const baseURL = "http://localhost:3000";
const outputDir = "var/qa/search";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TEST_BROWSER_PATH
    ? { executablePath: process.env.TEST_BROWSER_PATH }
    : process.platform === "win32" ? { channel: "chrome" } : {}),
});
const faults = [];
await mkdir(outputDir, { recursive: true });

async function checkPopupPlacement(page, list) {
  const box = await list.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1);
  const first = list.getByRole("link").first();
  await first.scrollIntoViewIfNeeded();
  assert.ok(await first.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), "The first suggestion is covered");
}

async function expectActiveRow(input, row) {
  const activeId = await input.getAttribute("aria-activedescendant");
  assert.ok(activeId && await row.evaluate((el, id) => el.contains(document.getElementById(id)), activeId),
    "Keyboard focus should identify a cell in the selected result");
}

async function checkPopupAccessibility(page, input) {
  await page.addScriptTag({ path: axePath });
  const violations = await input.evaluate(async (el) => {
    const { violations } = await window.axe.run(el.parentElement, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      resultTypes: ["violations"],
    });
    return violations.map(({ id, nodes }) => ({ id, elements: nodes.map((node) => node.target) }));
  });
  assert.deepEqual(violations, []);
}

async function checkLatestSuggestions(page, input, list) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pattern = "**/api/search/suggestions?**";
  await page.route(pattern, async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") !== "сире") return route.continue();
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    const oldRequest = page.waitForRequest((r) => {
      const u = new URL(r.url());
      return u.pathname === "/api/search/suggestions" && u.searchParams.get("q") === "сире";
    });
    await input.fill("сире");
    await oldRequest;
    await input.fill("портокал");
    await expect(list.getByRole("row").first()).toContainText(/портокал/i);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(list.getByRole("row").first()).toContainText(/портокал/i);
  await expect(list).not.toContainText(/сирене/i);
}

async function checkCatalog(page, size) {
  await page.goto("/produkti");
  const filters = page.getByRole("search", { name: "Филтри за продукти" });
  const input = filters.getByRole("combobox", { name: "Търси в продуктите" });
  const wrapper = filters.locator(".catalog-search");
  const sort = filters.getByRole("combobox", { name: "Сортиране" });
  const list = filters.getByRole("grid");
  const options = list.getByRole("row");
  const appearance = () => wrapper.evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.borderColor, style.boxShadow, style.outlineColor, style.outlineWidth].join(";");
  });
  const blurred = await appearance();
  await input.click();
  await expect.poll(appearance).not.toBe(blurred);
  const hasInnerRing = () => input.evaluate((el) => {
    const style = getComputedStyle(el);
    return (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0)
      || style.boxShadow !== "none";
  });
  assert.equal(await hasInnerRing(), false, "The input draws a second focus rectangle");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(input).toBeFocused();
  await expect.poll(appearance).not.toBe(blurred);
  assert.equal(await hasInnerRing(), false);
  await input.fill("портокал");
  const cards = page.locator(".product-card h3 a");
  await expect(cards.first()).toContainText(/портокал/i);
  await page.waitForURL((u) => u.searchParams.get("q") === "портокал");
  await expect(input).toBeFocused();
  await expect(options.first()).toContainText(/портокал/i);
  await expect(options.first()).toContainText(/1,79\s*€\s*\/\s*кг/);
  await expect.poll(() => options.first().locator("img").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(options.first().getByRole("link")).toHaveAttribute("href", await cards.first().getAttribute("href"));
  await checkPopupPlacement(page, list);
  await page.screenshot({ path: outputDir + "/catalog-" + size + ".png" });
  await input.press("Escape");
  await expect(list).toBeHidden();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("портокал");
  if (size === "desktop") {
    await checkLatestSuggestions(page, input, list);
    await filters.getByText("Всички резултати", { exact: true }).click();
    await expect(list).toBeHidden();
    await expect(cards.first()).toContainText(/портокал/i);
    await page.waitForURL((u) => u.pathname === "/produkti" && u.searchParams.get("q") === "портокал");
  }
  await filters.getByRole("checkbox", { name: /Налични/ }).check();
  await sort.selectOption("price-asc");
  await input.fill("мляко");
  await page.waitForURL((u) => u.searchParams.get("available") === "1" &&
    u.searchParams.get("sort") === "price-asc" && u.searchParams.get("q") === "мляко");
  await expect(cards.first()).toBeVisible();
  await expect(input).toBeFocused();
  await expect(sort).toHaveValue("price-asc");
  await expect(filters.getByRole("checkbox", { name: /Налични/ })).toBeChecked();
  await page.goto("/kategorii/mlechni-produkti?available=1&promo=1&sort=price-desc");
  const categoryRequest = page.waitForRequest((r) => {
    const u = new URL(r.url());
    return u.pathname === "/api/search/suggestions" && u.searchParams.get("q") === "fine life";
  });
  await input.fill("fine life");
  const requested = new URL((await categoryRequest).url()).searchParams;
  assert.equal(requested.get("category"), "mlechni-produkti");
  assert.equal(requested.get("available"), "1");
  assert.equal(requested.get("promo"), "1");
  assert.equal(requested.get("sort"), "price-desc");
  await page.waitForURL((u) => u.searchParams.get("q") === "fine life");
  await expect(cards).toHaveCount(2);
  await expect(options).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await expect(options.nth(i).getByRole("link")).toHaveAttribute("href", await cards.nth(i).getAttribute("href"));
    await expect(options.nth(i)).toContainText(await cards.nth(i).innerText());
  }
  await expect(sort).toHaveValue("price-desc");
  for (const label of ["Налични", "Промоции"]) {
    await expect(filters.getByRole("checkbox", { name: label })).toBeChecked();
  }
  const chosen = options.nth(1);
  const link = chosen.getByRole("link");
  const href = await link.getAttribute("href");
  if (size === "mobile") {
    await link.tap();
  } else {
    await input.press("ArrowDown");
    await input.press("ArrowDown");
    await expectActiveRow(input, chosen);
    await input.press("Enter");
  }
  await page.waitForURL((u) => u.pathname === new URL(href, baseURL).pathname);
}

async function checkSuggestions(page, size) {
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "Търсене на продукти" });
  const list = page.getByRole("grid");
  const items = list.getByRole("row");
  const suggestions = async (q) => {
    const response = await page.request.get("/api/search/suggestions", { params: { q } });
    assert.equal(response.status(), 200);
    const { products } = await response.json();
    return products;
  };
  const oranges = await suggestions("портокал");
  assert.match(oranges[0].name, /портокал/i);
  await input.fill("портокал");
  await expect(items.first()).toContainText(oranges[0].name);
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await checkPopupPlacement(page, list);
  await page.screenshot({ path: outputDir + "/suggestions-" + size + ".png" });

  if (size === "mobile") {
    await items.first().getByRole("link").tap();
    await page.waitForURL((u) => u.pathname === new URL(oranges[0].href, baseURL).pathname);
    return;
  }
  await input.press("Escape");
  await expect(list).toBeHidden();
  await expect(input).toBeFocused();
  await input.press("Enter");
  await page.waitForURL((u) => u.pathname === "/tarsene" && u.searchParams.get("q") === "портокал");
  await expect(page.locator(".product-card h3 a").first()).toHaveAttribute("href", oranges[0].href);

  await page.goto("/");
  const brandQuery = "fine life";
  const brandResults = await suggestions(brandQuery);
  assert.ok(brandResults.length >= 2);
  await input.fill(brandQuery);
  await expect(items.first()).toContainText(brandResults[0].name);
  for (let index = 0; index < 2; index += 1) {
    await input.press("ArrowDown");
    await expectActiveRow(input, items.nth(index));
  }
  await input.press("Enter");
  await page.waitForURL((u) => u.pathname === new URL(brandResults[1].href, baseURL).pathname);

  await page.goto("/");
  await checkLatestSuggestions(page, input, list);
  await input.fill("жжжжжжж");
  await expect(page.getByRole("status").filter({ hasText: /няма намерени продукти/i })).toBeVisible();
  await expect(list).toBeHidden();
  await input.fill("");
  await expect(list).toBeHidden();
}

async function checkSuggestionCart(page, size) {
  for (const item of [
    { path: "/", field: "Търсене на продукти", q: "сладолед", step: 1 },
    { path: "/produkti", field: "Търси в продуктите", q: "портокал", step: 0.1 },
  ]) {
    await page.goto(item.path);
    const input = page.getByRole("combobox", { name: item.field });
    await input.fill(item.q);
    if (item.path === "/produkti") await page.waitForURL((u) => u.searchParams.get("q") === item.q);
    const url = page.url();
    const row = page.getByRole("grid").getByRole("row").first();
    const plus = row.getByRole("button", { name: /Добави/i });
    const name = await row.locator(".site-search-name").innerText();
    await expect(plus).toHaveAccessibleName(new RegExp(item.q, "i"));
    await checkPopupAccessibility(page, input);
    const priceBox = await row.locator(".site-search-price").boundingBox();
    const buttonBox = await plus.boundingBox();
    assert.ok(priceBox && buttonBox && buttonBox.x >= priceBox.x + priceBox.width - 1
      && buttonBox.x + buttonBox.width <= page.viewportSize().width
      && Math.abs((buttonBox.y + buttonBox.height / 2) - (priceBox.y + priceBox.height / 2)) <= 4,
      "The add button should sit beside the price, inside the viewport");

    const form = input.locator("xpath=ancestor::form[1]");
    await form.evaluate((el) => {
      el.addEventListener("submit", () => el.dataset.submitted = "1", { once: true });
    });
    for (let count = 1; count <= 2; count++) {
      await expect(plus).toBeEnabled();
      if (size === "mobile") {
        await plus.tap();
      } else if (count === 1) {
        await plus.click();
      } else {
        await input.press("Escape");
        await input.press("ArrowDown");
        await input.press("ArrowRight");
        await input.press("Enter");
      }
      await expect.poll(() => page.evaluate((title) => {
        const lines = JSON.parse(localStorage.getItem("mikaela.cart.v1") || "[]");
        return lines.find((line) => line.title === title)?.quantity;
      }, name)).toBe(count * item.step);
      await expect(row).toBeVisible();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(item.q);
      await expect(page).toHaveURL(url);
      assert.equal(await form.getAttribute("data-submitted"), null);
    }
  }

  await page.goto("/kolichka");
  await page.reload();
  const lines = page.locator(".basket-row");
  await expect(lines).toHaveCount(2);
  const iceCream = lines.filter({ hasText: /сладолед/i });
  const oranges = lines.filter({ hasText: /портокал/i });
  await expect(iceCream.locator("output")).toHaveText("2");
  await expect(iceCream.locator(".basket-quantity b")).toHaveText(/1,99\s*€/);
  await expect(iceCream.getByLabel(/Желан вариант/i)).toBeVisible();
  await expect(oranges.locator("output")).toHaveText("0,2 кг");
  await expect(oranges.locator(".basket-quantity b")).toHaveText(/0,36\s*€/);
}

async function checkStockLimit(page) {
  const pattern = "**/api/search/suggestions?**";
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const unavailable = new URL(route.request().url()).searchParams.get("q") === "кафе";
    for (const product of data.products) {
      product.variant = unavailable ? null : { ...product.variant, max: 1 };
    }
    await route.fulfill({ response, json: data });
  });
  try {
    await page.goto("/");
    const input = page.getByRole("combobox", { name: "Търсене на продукти" });
    const row = page.getByRole("grid").getByRole("row").first();
    await input.fill("кафе");
    await expect(row.getByRole("link")).toContainText(/NESCAFE/i);
    await expect(row.locator("button:enabled:not([aria-disabled=true])")).toHaveCount(0);
    await input.fill("капсули");
    const add = row.getByRole("button", { name: /Добави/i });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(row.getByRole("link")).toBeVisible();
    await expect(row.locator("button:enabled:not([aria-disabled=true])")).toHaveCount(0);
    await page.goto("/kolichka");
    const coffee = page.locator(".basket-row").filter({ hasText: /NESCAFE/i });
    await expect(coffee.locator("output")).toHaveText("1");
    await expect(coffee.getByRole("button", { name: /Увеличи/i })).toBeDisabled();
  } finally {
    await page.unroute(pattern);
  }
}

try {
  for (const [size, width, height] of [["desktop", 1440, 960], ["mobile", 320, 740]]) {
    const context = await browser.newContext({
      baseURL, viewport: { width, height }, hasTouch: size === "mobile", reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      page.on("pageerror", (e) => faults.push(e.message));
      await checkSuggestions(page, size);
      await checkCatalog(page, size);
      await checkSuggestionCart(page, size);
      if (size === "desktop") await checkStockLimit(page);
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(faults, []);
} finally {
  await browser.close();
}
console.log("PASS: search and live catalog, quick add by pointer, touch and keyboard, persisted quantities and offer pricing at 320 and 1440 px.");
