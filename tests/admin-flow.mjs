// Run with node --env-file=.env.demo.local --import tsx tests/admin-flow.mjs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { createStaff } from "../src/auth/manage.ts";
import { pool } from "../src/db/index.ts";
import { removeFile, readFile } from "../src/storage/index.ts";

const base = new URL(process.env.APP_URL || "http://localhost:3100");
const db = new URL(process.env.DATABASE_URL || "");
assert.ok(
  ["localhost", "127.0.0.1"].includes(base.hostname) &&
    ["localhost", "127.0.0.1"].includes(db.hostname) &&
    db.pathname === "/mikaela_demo",
  "Изисква се отделната локална демонстрационна база.",
);
const tag = randomUUID().slice(0, 12),
  productName = "Проверка на снимка " + tag,
  team = [];
const files = new Set();
let productId = null,
  orderId = null,
  browser = null;
const completed = [];
function done(title) {
  completed.push(title);
  console.log("OK " + title);
}
function otp(secret) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = secret
    .split("")
    .map((x) => abc.indexOf(x).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((s) => parseInt(s, 2)));
  const frame = Buffer.alloc(8);
  frame.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(frame).digest();
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1e6)
    .toString()
    .padStart(6, "0");
}
async function temporaryUser(role) {
  const password = randomBytes(26).toString("base64url"),
    email = role + "." + tag + "@qa.invalid";
  const id = await createStaff("Проверка " + role, email, password, [role]);
  team.push(id);
  return { id, email, password };
}
async function json(r) {
  const data = await r.json();
  if (!r.ok())
    throw Error(r.status() + " " + (data.error || "неуспешна заявка"));
  return data;
}
async function login(page, user) {
  await page.goto("/admin/login");
  await page.getByLabel("Служебен имейл").fill(user.email);
  await page.getByLabel("Парола", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Влез", exact: true }).click();
}
const hint = { headers: { origin: base.origin } };
async function command(client, name, data) {
  return client.post("/api/admin/command", {
    ...hint,
    data: { command: name, data },
  });
}
try {
  const [staff, courier, owner] = await Promise.all(
    ["staff", "courier", "owner"].map(temporaryUser),
  );
  browser = await chromium.launch({
    channel: process.env.MIKAELA_BROWSER || "chrome",
    headless: true,
  });
  const ctx = await browser.newContext({
    baseURL: base.href,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(30000);
  await login(p, staff);
  await p.getByRole("heading", { name: "Работно табло" }).waitFor();
  await fs.mkdir("var/qa/admin", { recursive: true });
  await p.screenshot({
    path: "var/qa/admin/mobile-dashboard.png",
    animations: "disabled",
  });
  done("Служебен вход и работно табло");
  await p.goto("/admin/products/nov");
  await p.getByLabel("Име на продукта").fill(productName);
  await p.locator("select[name=category]").selectOption({ index: 1 });
  await p.locator("input[name=v0_pack]").fill("1 бр.");
  await p.locator("input[name=v0_regular]").fill("4,25");
  await p.locator("select[name=foodType]").selectOption("unpackaged");
  await p
    .locator("textarea[name=source]")
    .fill("Тестов етикет за двете разновидности");
  await p.locator("input[name=v0_name]").fill("Първи вкус");
  await p.getByRole("button", { name: "Добави разновидност" }).click();
  await p.locator("input[name=v1_name]").fill("Втори вкус");
  await p.locator("input[name=v1_pack]").fill("1 бр.");
  await p.locator("input[name=v1_regular]").fill("4,25");
  await p
    .getByText("Етикет на тази разновидност", { exact: true })
    .first()
    .click();
  await p
    .getByText("Етикет на тази разновидност", { exact: true })
    .last()
    .click();
  await p.locator("textarea[name=v0_food_allergens]").fill("Мляко");
  await p.locator("textarea[name=v1_food_allergens]").fill("Соя");
  const bytes = await sharp({
    create: { width: 350, height: 220, channels: 3, background: "#d87321" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const cam = p.locator("input[capture=environment]");
  assert.equal(await cam.count(), 1);
  await cam.setInputFiles({
    name: "camera.jpg",
    mimeType: "image/jpeg",
    buffer: bytes,
  });
  await p.getByRole("button", { name: "Завърти на 90°" }).click();
  await p.getByText("Изрежи краищата", { exact: true }).click();
  await p.locator("input[type=range]").first().fill("20");
  await p.getByRole("button", { name: "Потвърди снимката" }).click();
  await p.locator(".adm-thumb").first().waitFor();
  const gallery = p.locator(
    'input[type=file][accept="image/*"]:not([capture])',
  );
  await gallery.setInputFiles({
    name: "gallery.jpg",
    mimeType: "image/jpeg",
    buffer: bytes,
  });
  await p.getByRole("button", { name: "Потвърди снимката" }).click();
  await p.waitForFunction(
    () => document.querySelectorAll(".adm-thumb").length === 2,
  );
  await p.getByRole("button", { name: "Направи основна" }).click();
  for (const url of await p
    .locator(".adm-thumb img")
    .evaluateAll((images) => images.map((i) => i.getAttribute("src"))))
    files.add(url.replace("-card.webp", ".webp"));
  const dimensions = [];
  for (const url of files) {
    const key = url.replace(/^\/media\//, "");
    const full = await sharp(await readFile(key)).metadata();
    assert.equal(full.exif, undefined);
    assert.equal(full.orientation, undefined);
    assert.equal(full.format, "webp");
    const card = await sharp(
      await readFile(key.replace(".webp", "-card.webp")),
    ).metadata();
    assert.ok(Math.max(card.width, card.height) <= 480);
    dimensions.push([full.width, full.height]);
  }
  assert.deepEqual(
    dimensions,
    [
      [220, 350],
      [280, 220],
    ],
    "EXIF ориентация, ръчно завъртане и 20% ляво изрязване",
  );
  const confirm = p.waitForResponse((r) =>
    r.url().endsWith("/api/admin/command"),
  );
  await p.getByRole("button", { name: "Публикувай", exact: true }).click();
  const saved = await json(await confirm);
  productId = saved.href.split("/").pop();
  await p.waitForURL("**/admin/products/" + productId);
  await p.reload();
  assert.equal(await p.locator(".adm-thumb img").count(), 2);
  const product = (
    await pool.query("select slug from products where id=$1", [productId])
  ).rows[0];
  await p.goto("/tarsene?q=" + encodeURIComponent(productName));
  const cardImage = p.locator(".product-card")
    .filter({ has: p.getByRole("heading", { name: productName, exact: true }) })
    .locator(".product-image img");
  await cardImage.scrollIntoViewIfNeeded();
  const thumbnail = await cardImage.evaluate(async (img) => {
    await img.decode();
    return { url: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight };
  });
  assert.match(new URL(thumbnail.url).pathname, /-card\.webp$/);
  assert.ok(thumbnail.width > 0 && Math.max(thumbnail.width, thumbnail.height) <= 480);
  done(`В търсенето браузърът зареди -card.webp с размер ${thumbnail.width} × ${thumbnail.height} px`);
  const productResponse = await p.goto("/produkti/" + product.slug);
  assert.equal(
    productResponse.status(),
    200,
    "Публикуваният продукт трябва да е достъпен в каталога",
  );
  await p.getByRole("heading", { name: productName }).first().waitFor();
  const buttons = p.getByRole("group", { name: "Разновидност и разфасовка" });
  await buttons.getByRole("button", { name: /Първи вкус/ }).click();
  await p
    .locator(".product-details")
    .getByText("Мляко", { exact: true })
    .waitFor();
  await buttons.getByRole("button", { name: /Втори вкус/ }).click();
  await p
    .locator(".product-details")
    .getByText("Соя", { exact: true })
    .waitFor();
  assert.equal(
    await p
      .locator(".product-details")
      .getByText("Мляко", { exact: true })
      .count(),
    0,
  );
  done(
    "Картичката за избран вариант показва индивидуалните алергени от служебния формуляр.",
  );
  done(
    "Симулирана камера и галерия, преглед, завъртане, изрязване, две снимки, избор на основна, запис, презареждане и публичен продукт",
  );
  const bad = await ctx.request.post("/api/admin/media", {
    ...hint,
    multipart: {
      file: {
        name: "broken.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("broken"),
      },
    },
  });
  assert.equal(bad.status(), 400);
  done("Сървърът отхвърля повреден JPEG");
  const forbidden = await command(ctx.request, "settings.pause", {});
  assert.ok([400, 403].includes(forbidden.status()));
  done("Служител не може да променя настройките на собственика");
  const guest = await browser.newContext({ baseURL: base.href });
  const variant = (
    await pool.query("select id from variants where product_id=$1", [productId])
  ).rows[0];
  const delivery = await json(await guest.request.get("/api/delivery"));
  const zone = delivery.zones.find((z) => Number(z.min_cents) === 0);
  if (!zone) throw Error("Няма активен тестов район без минимум.");
  const slots = (
    await json(await guest.request.get("/api/delivery?zone=" + zone.id))
  ).slots;
  if (!slots.length) throw Error("Няма тестов интервал.");
  const draft = {
    zoneId: zone.id,
    slotId: slots[0].id,
    items: [
      {
        variantId: variant.id,
        quantity: 1,
        substitution: "skip",
        note: "",
        weightTolerance: 0,
      },
    ],
    payment: "cash",
  };
  const quote = await json(
    await guest.request.post("/api/quote", { ...hint, data: draft }),
  );
  const key = randomUUID();
  await json(
    await guest.request.post("/api/orders", {
      ...hint,
      data: {
        ...draft,
        quoteSignature: quote.signature,
        idempotencyKey: key,
        termsVersion: quote.termsVersion,
        customer: {
          name: "Проверка на доставка",
          phone: "0888000000",
          street: "Учебен адрес 1",
        },
      },
    }),
  );
  orderId = (
    await pool.query("select id from orders where idempotency_key=$1", [key])
  ).rows[0].id;
  await p.goto("/admin/orders/" + orderId);
  await p.getByRole("heading", { name: /Поръчка №/ }).waitFor();
  await p.getByRole("link", { name: "Потвърждение за клиента" }).waitFor();
  const printable = await ctx.newPage();
  await printable.goto("/admin/orders/" + orderId + "/print");
  await printable
    .getByRole("heading", { name: /Потвърждение за поръчка №/ })
    .waitFor();
  await printable
    .getByRole("heading", { name: /Общи условия · версия/ })
    .waitFor();
  await printable.goto("/admin/orders/" + orderId + "/print?mode=pick");
  await printable
    .getByRole("heading", { name: "Събиране по категории" })
    .waitFor();
  await printable.close();
  done(
    "Отделни печатни документи за събиране и трайно потвърждение с версия на общите условия",
  );
  const item = (
    await pool.query("select id from order_items where order_id=$1", [orderId])
  ).rows[0];
  for (const [action, data] of [
    ["confirm", {}],
    ["prepare", {}],
    ["item", { item: item.id, itemStatus: "prepared", quantity: "1" }],
    ["ready", {}],
  ]) {
    await json(
      await command(ctx.request, "order." + action, { id: orderId, ...data }),
    );
  }
  const deliveryCtx = await browser.newContext({ baseURL: base.href }),
    driver = await deliveryCtx.newPage();
  await login(driver, courier);
  await driver.waitForURL("**/dostavchik");
  assert.ok(
    [400, 403].includes(
      (
        await command(deliveryCtx.request, "order.deliver", { id: orderId })
      ).status(),
    ),
  );
  await json(
    await command(ctx.request, "order.assign", {
      id: orderId,
      courier: courier.id,
    }),
  );
  await json(await command(ctx.request, "order.dispatch", { id: orderId }));
  await driver.reload();
  await driver
    .getByRole("button", { name: "Доставена", exact: true })
    .waitFor();
  const finish = driver.waitForResponse((r) =>
    r.url().endsWith("/api/admin/command"),
  );
  await driver.getByRole("button", { name: "Доставена", exact: true }).click();
  await json(await finish);
  const state = (
    await pool.query(
      "select status,payment_status,total_cents from orders where id=$1",
      [orderId],
    )
  ).rows[0];
  assert.equal(state.status, "delivered");
  assert.equal(state.payment_status, "pending");
  await json(
    await command(deliveryCtx.request, "order.payment", {
      id: orderId,
      method: "cash",
      amount: (state.total_cents / 100).toFixed(2),
    }),
  );
  assert.equal(
    (
      await pool.query("select payment_status from orders where id=$1", [
        orderId,
      ])
    ).rows[0].payment_status,
    "paid",
  );
  done(
    "Гост поръчва, служител подготвя и възлага, доставчикът има достъп само по възлагане, отбелязва доставка и отделно плащане",
  );
  const ownCtx = await browser.newContext({ baseURL: base.href }),
    own = await ownCtx.newPage();
  await login(own, owner);
  await own.waitForURL("**/admin/2fa?enroll=1");
  const gated = await command(ownCtx.request, "settings.pause", {});
  assert.equal(gated.status(), 403);
  await own.getByLabel("Парола", { exact: true }).fill(owner.password);
  await own.getByRole("button", { name: "Свържи приложение" }).click();
  const code = own.locator("code");
  await code.waitFor();
  await own.getByLabel("Шестцифрен код").fill(otp(await code.textContent()));
  await own.getByRole("button", { name: "Потвърди", exact: true }).click();
  await own.getByRole("heading", { name: "Работно табло" }).waitFor();
  done("Собственикът е ограничен до потвърждение на истински TOTP");
  await own.screenshot({
    path: "var/qa/admin/desktop-dashboard.png",
    animations: "disabled",
  });
  for (const [route, title] of [
    ["content", "Съдържание"],
    ["settings", "Настройки"],
    ["team", "Служебни профили"],
    ["delivery", "Райони и доставки"],
    ["offers", "Промоции"],
    ["audit", "История на действията"],
  ]) {
    await own.goto("/admin/" + route);
    await own.getByRole("heading", { name: title, exact: true }).waitFor();
  }
  done(
    "Административни страници за CMS, настройки, екип, доставки, оферти и история",
  );
  const output = process.env.ADMIN_QA_RESULT || "var/qa/admin/result.json";
  if (output)
    await fs.writeFile(
      output,
      JSON.stringify({ passed: completed, physicalCamera: false }, null, 2),
    );
} finally {
  await browser?.close();
  // Remove only fixtures created by this run, including the capacity reservation for this synthetic delivery.
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (orderId) {
      await c.query(
        "update delivery_slots s set reserved=reserved-1 from orders o where o.id=$1 and s.id=o.slot_id and not o.capacity_released and reserved>0",
        [orderId],
      );
      for (const table of [
        "notification_jobs",
        "payments",
        "claims",
        "order_events",
        "order_items",
      ])
        await c.query("delete from " + table + " where order_id=$1", [orderId]);
      await c.query("delete from orders where id=$1", [orderId]);
    }
    if (!productId)
      productId = (
        await c.query("select id from products where name=$1", [productName])
      ).rows[0]?.id;
    if (productId) {
      await c.query(
        "delete from price_history where variant_id in(select id from variants where product_id=$1)",
        [productId],
      );
      for (const t of ["variants", "images"])
        await c.query("delete from " + t + " where product_id=$1", [productId]);
      await c.query("delete from products where id=$1", [productId]);
    }
    for (const id of team) {
      await c.query("delete from audit_log where actor=$1", [id]);
      await c.query("delete from staff_roles where user_id=$1", [id]);
      await c.query('delete from "user" where id=$1', [id]);
    }
    await c.query("commit");
  } catch (err) {
    await c.query("rollback");
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
  for (const url of files) {
    await removeFile(url);
    await removeFile(url.replace(".webp", "-card.webp"));
  }
}
