// Run with the local flyer shop on port 3000: node tests/shop-redesign.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const base = "http://localhost:3000";
const out = "var/qa/redesign";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const report = {
  date: new Date().toISOString(),
  screens: [],
  interactions: [],
  offers: [],
  requestsToOrders: 0,
  pageErrors: [],
  complete: false,
};
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TEST_BROWSER_PATH
    ? { executablePath: process.env.TEST_BROWSER_PATH }
    : process.platform === "win32"
      ? { channel: "chrome" }
      : {}),
});
const squeeze = (s) => s.replace(/\s+/g, " ").trim();
async function inspect(page, size, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".product-card .add-button:enabled").first().waitFor();
  await page.evaluate(async () => {
    const heading = document.querySelector(".edition-title");
    if (heading) await Promise.allSettled(heading.getAnimations({subtree:true}).map(a=>a.finished));
  });
  await page.addScriptTag({ path: axePath });
  const scan = await page.evaluate(async () => {
    const scan = await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
      resultTypes: ["violations", "incomplete"],
    });
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      violations: scan.violations.map((v) => ({
        rule: v.id,
        impact: v.impact,
        elements: v.nodes.map((n) => n.target),
      })),
      manual: scan.incomplete.map((v) => v.id),
    };
  });
  report.screens.push({ size, name, ...scan });
  assert.ok(scan.scrollWidth <= scan.width, name + " overflow at " + size);
}
try {
  for (const [size, width, height] of [
    ["desktop", 1440, 960],
    ["tablet", 820, 1180],
    ["mobile", 390, 844],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      locale: "bg-BG",
      timezoneId: "Europe/Sofia",
      reducedMotion: size === "desktop" ? "no-preference" : "reduce",
    });
    try {
      await ctx.route("**/api/orders", (r) => {
        report.requestsToOrders++;
        return r.abort();
      });
      ctx.on("page", (p) =>
        p.on("pageerror", (e) => report.pageErrors.push(e.message)),
      );
      const p = await ctx.newPage();
      p.setDefaultTimeout(12000);
      await p.goto(base);
      const hero = p.locator(".edition-hero"),
        dots = hero.locator(".edition-dots button");
      await hero.locator(".hero-image").evaluate((i) => i.decode());
      assert.equal(await dots.count(), 5);
      if (size !== "tablet")
        await p.screenshot({ path: out + "/home-" + size + ".png" });
      await p.keyboard.press("Tab");
      await p.waitForFunction(() => {
        const skip = document.querySelector(".skip-link");
        return skip === document.activeElement && skip.getBoundingClientRect().bottom > 0;
      });
      const cats = p.locator(".edition-categories a");
      assert.equal(await cats.count(), 9);
      assert.ok(
        await cats.evaluateAll((links) =>
          links.every((a) => {
            const r = a.getBoundingClientRect();
            return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1;
          }),
        ),
        size + " categories",
      );
      const categories = new Set(
        await cats.evaluateAll((links) => links.map((a) => a.pathname)),
      );
      assert.equal(categories.size, 9);
      const active = () =>
        dots.evaluateAll((bs) =>
          bs.findIndex((b) => b.getAttribute("aria-current") === "true"),
        );
      if (size === "desktop") {
        const initial = await active();
        await p.waitForFunction(
          (i) =>
            [...document.querySelectorAll(".edition-dots button")].findIndex(
              (b) => b.getAttribute("aria-current") === "true",
            ) !== i,
          initial,
          { timeout: 12000 },
        );
        await hero
          .getByRole("button", { name: "Спри автоматичната смяна" })
          .click();
        await hero
          .getByRole("button", { name: "Пусни автоматичната смяна" })
          .waitFor();
        const paused = await active();
        await p.mouse.move(1, 1);
        await p.locator(".skip-link").focus();
        await p.waitForTimeout(7600);
        assert.equal(await active(), paused);
        const t = await ctx.newPage();
        for (let i = 0; i < 5; i++) {
          await dots.nth(i).click();
          assert.equal(await active(), i);
          const href = await hero.locator(".edition-cta").getAttribute("href");
          assert.match(href, /^\/produkti\//);
          await t.goto(base + href);
          const price = squeeze(
            await hero.locator(".edition-ticket-data b").innerText(),
          );
          assert.equal(
            price,
            squeeze(await t.locator(".detail-price").innerText()),
          );
          report.offers.push({ href, price });
        }
        assert.equal(new Set(report.offers.map((s) => s.href)).size, 5);
        await t.close();
        await hero.getByRole("button", { name: "Следваща оферта" }).click();
        assert.equal(await active(), 0);
        await hero.getByRole("button", { name: "Предишна оферта" }).click();
        assert.equal(await active(), 4);
        await p.keyboard.press("ArrowRight");
        assert.equal(await active(), 0);
        await p.keyboard.press("ArrowLeft");
        assert.equal(await active(), 4);
        await dots.first().click();
        report.interactions.push(
          "Автоматична смяна, пауза, пет връзки с действителни цени, стрелки и клавиатура",
        );
      } else {
        assert.equal(await hero.locator(".edition-play").count(), 0);
      }
      await inspect(p, size, "home");
      if (size === "desktop") {
        const breakfast = p.locator(".breakfast-selection"),
          checks = breakfast.getByRole("checkbox");
        assert.ok((await checks.count()) >= 3);
        await breakfast.locator(".breakfast-pick").last().click();
        assert.equal(await checks.last().isChecked(), false);
        const selected = await breakfast.locator("input:checked").count();
        await breakfast
          .getByRole("button", { name: /Добави избраните/ })
          .click();
        await breakfast.getByRole("link", { name: /Към количката/ }).click();
        await p.waitForURL("**/kolichka");
        await p.reload();
        await p.locator(".basket-row").first().waitFor();
        assert.equal(await p.locator(".basket-row").count(), selected);
        report.interactions.push(
          selected +
            " избрани артикула от закуската в количката след презареждане",
        );
      }
      await p.goto(base + "/produkti");
      const filters = p.getByRole("search", { name: "Филтри за продукти" }),
        nav = p.getByRole("navigation", { name: "Категории продукти" });
      await filters.waitFor();
      assert.equal(await nav.getByRole("link").count(), 10);
      if (size === "desktop")
        await p.screenshot({ path: out + "/catalog-desktop.png" });
      await inspect(p, size, "catalog");
      if (size === "desktop" || size === "mobile") {
        const search = filters.getByRole("combobox", { name: "Търси в продуктите" }),
          sort = filters.getByRole("combobox", { name: "Сортиране" });
        const count = p.locator(".catalog-heading span");
        const waitUrl = (fn) => p.waitForURL(fn, { timeout: 10000 });
        await search.fill("сирене");
        await waitUrl((u) => u.searchParams.get("q") === "сирене");
        await p.waitForFunction(
          () =>
            Number(
              document
                .querySelector(".catalog-heading span")
                ?.textContent?.split(" ")[0],
            ) < 56,
        );
        assert.ok((await p.locator(".product-card").count()) > 0);
        const available = filters.getByRole("checkbox", { name: /Налични/ });
        await available.focus();
        await p.keyboard.press("Space");
        await waitUrl((u) => u.searchParams.get("available") === "1");
        await filters.getByRole("checkbox", { name: /Промоции/ }).focus();
        await p.keyboard.press("Space");
        await waitUrl((u) => u.searchParams.get("promo") === "1");
        await sort.selectOption("price-asc");
        await waitUrl((u) => u.searchParams.get("sort") === "price-asc");
        await p.locator('.catalog-main [aria-busy="false"]').waitFor();
        const prices = (
          await p.locator(".product-card .price-row strong").allInnerTexts()
        ).map((label) =>
          Number(label.match(/\d+[,.]\d{2}/)[0].replace(",", ".")),
        );
        assert.ok(prices.length > 1);
        assert.deepEqual(
          prices,
          [...prices].sort((a, b) => a - b),
        );
        await nav.getByRole("link", { name: "Млечни продукти" }).click();
        await waitUrl(
          (u) =>
            u.pathname === "/kategorii/mlechni-produkti" &&
            u.searchParams.get("q") === "сирене",
        );
        await p.locator('.catalog-main [aria-busy="false"]').waitFor();
        const categoryTags = await p
          .locator(".product-card .product-category")
          .allInnerTexts();
        assert.ok(
          categoryTags.length &&
            categoryTags.every((text) => text.trim().toLocaleLowerCase("bg-BG") === "млечни продукти"),
        );
        await p.goBack();
        await waitUrl(
          (u) =>
            u.pathname === "/produkti" &&
            u.searchParams.get("sort") === "price-asc",
        );
        assert.equal(await sort.inputValue(), "price-asc");
        assert.ok(await available.isChecked());
        await filters.getByRole("button", { name: "Изчисти" }).click();
        await waitUrl((u) => u.pathname === "/produkti" && !u.search);
        await p.waitForFunction(
          () =>
            document.querySelector(".catalog-heading span")?.textContent ===
            "56 продукта",
        );
        assert.equal(await search.inputValue(), "");
        report.interactions.push(
          size +
            " – търсене, наличност, промоции, сортиране, категория, история, изчистване",
        );
      }
    } finally {
      await ctx.close();
    }
  }
  assert.equal(report.requestsToOrders, 0);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(
    report.screens.flatMap((s) =>
      s.violations.map((v) => ({ size: s.size, name: s.name, ...v })),
    ),
    [],
  );
  report.complete = true;
} finally {
  await writeFile(out + "/result.json", JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(
  "PASS: 5 оферти и цени, закуска, 9 категории, автоматични филтри, 6 WCAG проверки на 3 размера.",
);
