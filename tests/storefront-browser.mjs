import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const origin = new URL(process.env.SHOP_TEST_URL || "http://localhost:3100");
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) {
  throw new Error(
    "Проверката на поръчки се изпълнява само в локалния демонстрационен магазин.",
  );
}
const evidence = path.resolve("var/qa/storefront");
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TEST_BROWSER_PATH
    ? { executablePath: process.env.TEST_BROWSER_PATH }
    : process.platform === "win32"
      ? { channel: "chrome" }
      : {}),
});
const checks = [];
const problems = [];
const sizes = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 960 },
];

try {
  for (const { name, width, height } of sizes) {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: "bg-BG",
      timezoneId: "Europe/Sofia",
      reducedMotion: "reduce",
      hasTouch: name !== "desktop",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(18000);
    page.on("pageerror", (error) => problems.push(error.message));
    const response = await page.goto(origin.href, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200);
    await page.getByText("Демонстрационен магазин", { exact: true }).waitFor();
    await page.locator("main h1").waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert(
      await page
        .locator(".hero-image")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    );
    assert((await page.locator(".product-card").count()) > 0);
    await page.screenshot({ path: path.join(evidence, name + "-home.png") });
    checks.push(
      name +
        " — начална страница, продуктови снимки, без хоризонтално преливане",
    );
    if (name === "desktop") {
      await page.keyboard.press("Tab");
      assert(
        await page
          .locator(".skip-link")
          .evaluate((link) => link === document.activeElement),
      );
      await page.keyboard.press("Enter");
      assert(
        await page
          .locator("#main-shop")
          .evaluate((main) => main === document.activeElement),
      );
      checks.push(
        "Клавиатурно прескачане до основното съдържание при намалени анимации",
      );
    }
    const district = page.getByRole("button", {
      name: /Провери района за доставка/,
    });
    await district.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector('[role="dialog"]')
        ?.contains(document.activeElement),
    );
    await dialog
      .locator("select option:nth-child(2)")
      .waitFor({ state: "attached" });
    await dialog.locator("select").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Избери район" }).click();
    await dialog.waitFor({ state: "hidden" });
    if (name !== "mobile") {
      await context.close();
      continue;
    }

    await page.getByRole("button", { name: "Отвори менюто" }).click();
    await dialog.getByRole("link", { name: "Всички продукти" }).click();
    await page.waitForURL("**/produkti");
    const catalogImages = await page.locator(".product-image img").all();
    let thumbnails = 0;
    for (const image of catalogImages) {
      await image.scrollIntoViewIfNeeded();
      const dimensions = await image.evaluate(async (element) => {
        await element.decode();
        return {
          src: element.currentSrc,
          width: element.naturalWidth,
          height: element.naturalHeight,
        };
      });
      assert(dimensions.width > 0 && dimensions.height > 0);
      if (
        /\/media\/(?:uploads\/|brochures\/[a-f0-9]{64}\/v(?:[3-9]|\d{2,})\/)/i.test(
          dimensions.src,
        )
      ) {
        assert(dimensions.src.endsWith("-card.webp"), dimensions.src);
        assert(Math.max(dimensions.width, dimensions.height) <= 480);
        thumbnails++;
      }
    }
    assert(catalogImages.length > 0);
    checks.push(
      `Заредени продуктови снимки в каталога: ${catalogImages.length}, отделни малки изображения: ${thumbnails}`,
    );
    const card = page
      .locator(".product-card")
      .filter({ has: page.locator("button[aria-label^='Добави ']:enabled") })
      .first();
    const nameOfProduct = (await card.locator("h3").innerText()).trim();
    const detailHref = await card.locator("h3 a").getAttribute("href");
    const chosenCard = page
      .locator(".product-card")
      .filter({
        has: page.getByRole("heading", { name: nameOfProduct, exact: true }),
      })
      .first();
    await card.locator("button[aria-label^='Добави ']").click();
    await chosenCard.locator("output").waitFor();
    await chosenCard
      .getByRole("button", { name: "Увеличи " + nameOfProduct })
      .click();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Отвори количката" }).click();
    await dialog.getByRole("link", { name: "Към количката" }).click();
    await page.waitForURL("**/kolichka");
    await page.locator(".basket-row").first().waitFor();
    assert.equal(await page.locator(".basket-row").count(), 1);
    await page.locator(".basket-row summary").click();
    await page.locator(".basket-row details select").selectOption("call");
    await page
      .getByLabel("Бележка за артикула")
      .fill("Демонстрационна проверка.");
    await page.getByRole("link", { name: "Към завършване" }).click();
    await page.waitForURL("**/porachka");
    const interval = page.getByLabel("Ден и часови интервал");
    await interval
      .locator("option:nth-child(2)")
      .waitFor({ state: "attached" });
    await interval.selectOption({ index: 1 });
    await page.locator("input[name=name]").fill("Учебен клиент");
    await page.locator("input[name=phone]").fill("0000000000");
    await page.locator("input[name=street]").fill("Учебна улица 1");
    const terms = page.getByRole("checkbox", { name: /Прегледах сумите/ });
    await page.waitForFunction(
      () => document.querySelector(".total-line dt")?.textContent === "Общо",
    );
    await terms.check();
    const orderButton = page.getByRole("button", {
      name: "Поръчвам с плащане при доставка",
    });
    assert(await orderButton.isEnabled());
    await page.screenshot({ path: path.join(evidence, "mobile-checkout.png") });
    await orderButton.click();
    await page.waitForURL("**/prosledyavane/*");
    await page.getByRole("heading", { name: "Поръчката е получена" }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Поръчката е получена" }).waitFor();
    await page.getByRole("button", { name: "Отмени преди подготовка" }).click();
    await page
      .getByLabel("Причина за отмяната")
      .fill("Край на демонстрационната проверка.");
    await page.getByRole("button", { name: "Преглед на заявлението" }).click();
    await page.getByRole("button", { name: "Потвърди отмяната" }).click();
    await page.getByText("Поръчката е отменена.", { exact: true }).waitFor();
    checks.push(
      "Мобилна навигация, избор на район, добавяне и редакция, презареждане, гост поръчка, проследяване, отмяна",
    );
    const search = page.locator("#site-search");
    await search.fill(nameOfProduct);
    await search.press("Enter");
    await page.waitForURL("**/tarsene?*");
    assert((await page.locator(".product-card").count()) > 0);
    await page.goto(new URL(detailHref, origin).href);
    await page
      .getByRole("heading", { level: 1, name: nameOfProduct })
      .waitFor();
    for (const href of [
      "/broshura",
      "/promocii",
      "/informacia/dostavka",
      "/informacia/otkaz-i-reklamacii",
      "/informacia/obshti-usloviya",
    ]) {
      const r = await page.goto(new URL(href, origin).href);
      assert.equal(r?.status(), 200, href);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        href,
      );
    }
    checks.push(
      "Търсене, продуктова страница, брошура, промоции, доставка, отказ, общи условия",
    );
    await context.close();
  }
  assert.deepEqual(problems, []);
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks,
        browser: browser.version(),
        problems,
      },
      null,
      2,
    ),
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
}
