// After npm run build: node --env-file=.env.local --import tsx tests/hero-carousel.mjs
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { chromium, expect } from "@playwright/test";
import { Client } from "pg";

const connection = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(connection.hostname), "Изисква се локален PostgreSQL.");
const database = "mikaela_carousel_" + randomUUID().replaceAll("-", "");
const adminURL = new URL("/postgres", connection);
const admin = new Client({ connectionString: adminURL.href });
await admin.connect();
await admin.query('CREATE DATABASE "' + database + '"');
let pool, server, browser, mediaDir;

async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

try {
  const port = await freePort();
  const base = "http://127.0.0.1:" + port;
  mediaDir = await mkdtemp(path.join(tmpdir(), "mikaela-carousel-"));
  Object.assign(process.env, {
    APP_URL: base,
    DATABASE_URL: new URL("/" + database, connection).href,
    BETTER_AUTH_SECRET: randomBytes(40).toString("hex"),
    LOCAL_BROCHURE_CAMPAIGN: "",
    NOTIFICATION_MODE: "test",
    STORAGE_DRIVER: "local",
    STORAGE_DIR: mediaDir,
  });
  const migration = spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { windowsHide: true });
  assert.equal(migration.status, 0, "Миграциите в тестовата база са неуспешни.");
  ({ pool } = await import("../src/db/index.ts"));
  const { createStaff } = await import("../src/auth/manage.ts");
  const { rows: [category] } = await pool.query("INSERT INTO categories(name,slug) VALUES('Плодове','plodove') RETURNING id");
  const { rows: [product] } = await pool.query(
    "INSERT INTO products(name,slug,status,category_id) VALUES('Десертни портокали','portokali','published',$1) RETURNING id",
    [category.id],
  );
  await pool.query("INSERT INTO variants(product_id,name,pack,regular_cents) VALUES($1,'Портокали','1 бр.',235)", [product.id]);
  await pool.query("INSERT INTO images(product_id,url) VALUES($1,'/design/campaign-citrus.webp')", [product.id]);
  const email = "owner@carousel.example.invalid";
  const password = randomBytes(24).toString("base64url");
  await createStaff("Собственик на теста", email, password, ["owner"]);

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    windowsHide: true, stdio: "ignore",
  });
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    assert.equal(server.exitCode, null, "Тестовият магазин приключи преди да се стартира.");
    ready = await fetch(base + "/api/health").then(r => r.ok, () => false);
    if (!ready) await delay(250);
  }
  assert.ok(ready, "Тестовият магазин не отговори.");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.TEST_BROWSER_PATH ? { executablePath: process.env.TEST_BROWSER_PATH } : process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const owner = await browser.newPage({ baseURL: base, viewport: { width: 1400, height: 970 } });
  owner.setDefaultTimeout(10000);
  await owner.goto("/admin/login");
  await owner.getByLabel("Служебен имейл").fill(email);
  await owner.getByLabel("Парола", { exact: true }).fill(password);
  await owner.getByRole("button", { name: "Влез", exact: true }).click();
  await owner.waitForURL("**/admin/2fa?enroll=1");
  await owner.getByLabel("Парола", { exact: true }).fill(password);
  await owner.getByRole("button", { name: "Свържи приложение" }).click();
  const seed = await owner.locator("code").textContent();
  await owner.getByLabel("Шестцифрен код").fill(await createOTP(base32.decode(seed)).totp());
  await owner.getByRole("button", { name: "Потвърди", exact: true }).click();
  await owner.getByRole("heading", { name: "Работно табло" }).waitFor();
  await owner.goto("/admin/content#karusel");

  const editor = owner.locator("#karusel");
  const command = async (button) => {
    const response = owner.waitForResponse(r => r.url().endsWith("/api/admin/command") && r.request().method() === "POST");
    await editor.getByRole("button", { name: button, exact: true }).click();
    const saved = await response;
    const body = await saved.json();
    assert.equal(saved.status(), 200, body.error || "Слайдовете трябва да се запишат.");
    return body;
  };
  const headings = ["Свежи плодове", "Уикенд в кухнята"];
  await editor.getByRole("radio", { name: "Ръчен подбор" }).check();
  const add = editor.getByRole("button", { name: "Добави слайд" });
  const type = editor.getByLabel("Тип на слайда");
  const title = editor.getByLabel("Заглавие", { exact: true });
  if (!(await type.count())) await add.click();
  await type.selectOption("product");
  await editor.getByLabel("Продукт", { exact: true }).selectOption(product.id);
  await title.fill(headings[0]);
  await add.click();
  await type.selectOption("custom");
  await title.fill(headings[1]);
  await editor.getByLabel("Текст на бутона").fill("Към каталога");
  await editor.getByLabel(/^Връзка/).fill("/produkti");
  await editor.getByText("Добави снимка", { exact: true }).click();
  await editor.locator('input[type=file][accept="image/*"]:not([capture])').setInputFiles("public/design/campaign-citrus.webp");
  await editor.getByRole("button", { name: "Потвърди снимката" }).click();
  await editor.getByLabel(/^Описание на снимката/).fill("Жена с портокали");
  await editor.getByRole("button", { name: "Премести наляво" }).click();
  await editor.getByLabel("Автоматична смяна", { exact: true }).check();
  await editor.getByLabel("Време на слайд (секунди)").fill("4");
  await command("Запази чернова");
  const draftThumbnail = await editor.locator(".adm-thumb img").getAttribute("src");

  const guest = await browser.newPage({ baseURL: base, viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
  await guest.goto("/");
  const hero = guest.locator(".edition-hero");
  await expect(hero).not.toContainText(headings[1]);
  assert.equal((await guest.request.get(draftThumbnail)).status(), 404, "Черновата снимка остава служебна.");
  await owner.reload();
  await expect(editor.getByRole("radio", { name: "Ръчен подбор" })).toBeChecked();
  await expect(title).toHaveValue(headings[1]);
  await command("Публикувай карусела");
  await mkdir("var/qa/carousel", { recursive: true });
  await editor.screenshot({ path: "var/qa/carousel/admin-desktop.png" });
  await owner.setViewportSize({ width: 390, height: 844 });
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Панелът за редакция излиза извън екрана на телефона.");
  await editor.screenshot({ path: "var/qa/carousel/admin-mobile.png" });
  await owner.setViewportSize({ width: 1400, height: 970 });
  const dot = hero.locator(".edition-dots button");
  await guest.reload();
  await expect(dot).toHaveCount(2);
  await expect(hero.getByRole("heading", { name: headings[1] })).toBeVisible();
  await expect(hero.getByRole("link", { name: "Към каталога" })).toHaveAttribute("href", "/produkti");
  const scene = hero.getByRole("img", { name: "Жена с портокали" });
  assert.ok(await scene.evaluate(async (image) => { await image.decode(); return image.naturalWidth > 0; }));
  await guest.evaluate(() => document.fonts.ready);
  const heroHeight = (await hero.boundingBox()).height;
  assert.equal((await guest.request.get(draftThumbnail)).status(), 200);
  const transition = hero.evaluate((region) => new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!region.querySelector(".edition-art-out")) return;
      const animations = region.getAnimations({ subtree: true });
      const animatedFrames = animations.filter(a => a.effect.getComputedTiming().duration > 0).length;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(animatedFrames);
    });
    observer.observe(region, { childList: true, subtree: true, attributes: true });
    const timer = window.setTimeout(() => { observer.disconnect(); resolve(0); }, 6500);
  }));
  const before = Date.now();
  await expect(hero.getByRole("heading", { name: headings[0] })).toBeVisible({ timeout: 6200 });
  assert.ok(Date.now() - before >= 2500, "Слайдовете се сменят преди зададения интервал.");
  assert.ok(await transition > 0, "Автоматичната смяна трябва да има видим анимиран преход.");
  await hero.getByRole("button", { name: "Спри автоматичната смяна" }).click();
  assert.ok(Math.abs((await hero.boundingBox()).height - heroHeight) <= 1, "Смяната на офертата измества каталога под карусела.");
  await expect(hero.locator(".edition-ticket-data b")).toHaveText(/2,35/);
  await expect(hero.getByRole("link")).toHaveAttribute("href", "/produkti/portokali");
  assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await pool.query("UPDATE variants SET regular_cents=310 WHERE product_id=$1", [product.id]);
  await guest.reload();
  await dot.nth(1).click();
  await expect(hero.locator(".edition-ticket-data b")).toHaveText(/3,10/);

  const getSettings = async () => (await pool.query("SELECT value FROM settings WHERE key='heroCarousel'")).rows[0].value;
  const state = await getSettings();
  const api = async (config, revision) => owner.request.post("/api/admin/command", {
    headers: { origin: base },
    data: { command: "page.carousel", data: { operation: "publish", config: JSON.stringify(config), revision: String(revision) } },
  });
  const stale = await api(state.published, state.revision - 1);
  assert.ok([400, 409].includes(stale.status()));
  assert.match((await stale.json()).error, /променен/);
  const invalid = structuredClone(state.published);
  invalid.slides[0].href = "invalid-scheme:unavailable";
  assert.equal((await api(invalid, state.revision)).status(), 400, "Трябва да се отхвърли невалидна връзка.");
  await pool.query("UPDATE products SET status='hidden' WHERE id=$1", [product.id]);
  await guest.reload();
  await expect(hero.getByRole("heading", { name: headings[1] })).toBeVisible();
  await expect(dot).toHaveCount(0);
  assert.equal((await api(state.published, state.revision)).status(), 400, "Скрит продукт не трябва да се публикува в карусела.");
  await pool.query("UPDATE products SET status='published' WHERE id=$1", [product.id]);
  assert.deepEqual(await getSettings(), state);

  await guest.emulateMedia({ reducedMotion: "reduce" });
  await guest.reload();
  await expect(dot).toHaveCount(2);
  await dot.nth(1).click();
  await expect(hero.getByRole("heading", { name: headings[0] })).toBeVisible();
  await expect(hero.locator(".edition-art-out, .edition-play")).toHaveCount(0);
  await editor.getByLabel("Автоматична смяна", { exact: true }).uncheck();
  await command("Публикувай карусела");
  await guest.emulateMedia({ reducedMotion: "no-preference" });
  await guest.reload();
  await expect(dot).toHaveCount(2);
  await expect(hero.locator(".edition-play")).toHaveCount(0);
  await guest.waitForTimeout(4250);
  await expect(hero.getByRole("heading", { name: headings[1] })).toBeVisible();

  await editor.getByLabel("Показвай слайда").uncheck();
  await command("Публикувай карусела");
  await guest.reload();
  await expect(hero.getByRole("heading", { name: headings[0] })).toBeVisible();
  await expect(hero).not.toContainText(headings[1]);
  await expect(dot).toHaveCount(0);
  assert.equal((await guest.request.get(draftThumbnail)).status(), 404, "Снимката на скрития слайд е оттеглена.");
  await editor.locator(".carousel-slide-list button[aria-pressed]").nth(1).click();
  await editor.getByLabel("Показвай слайда").uncheck();
  await command("Публикувай карусела");
  await guest.reload();
  await expect(hero).toHaveCount(0);
  await editor.getByRole("radio", { name: "От брошурата" }).check();
  await command("Публикувай карусела");
  await guest.reload();
  await expect(hero).toBeVisible();
  console.log("PASS: администратор с 2FA, чернова, публикуване, ред, скриване, свързан продукт с актуална цена, връзка, автоматична смяна и конфликти при редакция.");
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  await pool?.end();
  if (mediaDir && path.dirname(path.resolve(mediaDir)) === path.resolve(tmpdir())) {
    await rm(mediaDir, { recursive: true, force: true });
  }
  try { await admin.query('DROP DATABASE "' + database + '" WITH (FORCE)'); }
  finally { await admin.end(); }
}
