// Run against the enabled loopback shop: node --env-file=.env.local tests/brochure-checkout.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const base = "http://localhost:3000";
const url = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/mikaela");
assert.equal(new URL(process.env.APP_URL).origin, base);
assert.equal(process.env.NOTIFICATION_MODE, "test");
const campaign = process.env.LOCAL_BROCHURE_CAMPAIGN;
assert.match(campaign || "", /^[a-f0-9-]{36}$/i);
const db = new Client({ connectionString: url.href });
await db.connect();
await db.query("SET default_transaction_read_only = on");
let browser;
let receipt;
const post = async (path, data) => {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
};
const testName = "Тестова поръчка на брошурата " + randomUUID().slice(0, 8);
try {
  const { rows: entries } = await db.query(
    `SELECT p.slug,v.id,i.extracted->>'name' AS name, (i.extracted->>'priceCents')::int AS cents,
    i.extracted->>'unit' AS unit, (i.extracted->>'buy')::int AS buy, (i.extracted->>'pay')::int AS pay,
    (p.source_data->'food'->>'ageRestricted')::boolean AS restricted,c.ends::text AS ends
    FROM brochure_campaigns c JOIN brochure_items i ON i.batch_id=c.current_batch JOIN brochure_sources s USING(source_key)
    JOIN variants v ON v.id=s.draft_variant JOIN products p ON p.id=v.product_id
    WHERE c.id=$1 AND (now() AT TIME ZONE 'Europe/Sofia')::date BETWEEN c.starts AND c.ends
    ORDER BY i.page,i.ordinal`,
    [campaign],
  );
  assert.equal(entries.length, 56);
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  browser = await chromium.launch({
    headless: true,
    ...(process.env.TEST_BROWSER_PATH
      ? { executablePath: process.env.TEST_BROWSER_PATH }
      : process.platform === "win32"
        ? { channel: "chrome" }
        : {}),
  });
  const page = await browser.newPage({
    locale: "bg-BG",
    timezoneId: "Europe/Sofia",
  });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const seen = new Set();
  for (let catalogPage = 1; catalogPage <= 3; catalogPage++) {
    await page.goto(base + "/produkti?page=" + catalogPage, {
      waitUntil: "domcontentloaded",
    });
    for (const card of await page.locator(".product-card").all()) {
      const path = await card.locator("h3 a").getAttribute("href");
      const entry = bySlug.get(decodeURIComponent(path.split("/").at(-1)));
      if (!entry) continue;
      assert.ok(!seen.has(entry.id));
      seen.add(entry.id);
      await card
        .getByRole("button", { name: "Добави " + entry.name, exact: true })
        .click();
      await card.locator("output").waitFor();
      if (entry.buy > 1)
        await card
          .getByRole("button", { name: "Увеличи " + entry.name, exact: true })
          .click();
    }
  }
  assert.equal(seen.size, 56);
  await page.goto(base + "/kolichka");
  await page.locator(".basket-row").first().waitFor();
  assert.equal(await page.locator(".basket-row").count(), 56);
  const choiceBoxes = page.getByRole("textbox", { name: /^Желан вариант за / });
  const choices = new Map();
  for (const box of await choiceBoxes.all()) {
    const label =
      (await box.getAttribute("aria-label")) ||
      (await box.evaluate((el) => el.labels?.[0]?.innerText));
    const product = entries.find(
      (e) => label === "Желан вариант за " + e.name || label?.includes(e.name),
    );
    assert.ok(product, label);
    const choice = product.name.includes("Ванилия")
      ? "Ванилия, 1 л"
      : "Тестов избор за " + product.name.split(" ").slice(0, 3).join(" ");
    await box.fill(choice);
    choices.set(product.id, choice);
  }
  assert.ok(choices.size > 0);
  await page.reload();
  await page.locator(".basket-row").first().waitFor();
  assert.equal(await page.locator(".basket-row").count(), 56);
  for (const [id, choice] of choices) {
    const product = entries.find((e) => e.id === id);
    assert.equal(
      await page
        .getByRole("textbox", {
          name: "Желан вариант за " + product.name,
          exact: true,
        })
        .inputValue(),
      choice,
    );
  }
  await page.goto(base + "/porachka");
  const zone = page.getByLabel("Населено място или район");
  await zone.locator("option:nth-child(2)").waitFor({ state: "attached" });
  const testZone = (
    await db.query(
      "SELECT id FROM delivery_zones WHERE test_only AND active ORDER BY name LIMIT 1",
    )
  ).rows[0];
  assert.ok(testZone, "За тази проверка е необходим локалният тестов район.");
  await zone.selectOption(testZone.id);
  const slot = page.getByLabel("Ден и часови интервал");
  await slot.locator("option:nth-child(2)").waitFor({ state: "attached" });
  await slot.selectOption({ index: 1 });
  const zoneId = await zone.inputValue(),
    slotId = await slot.inputValue();
  const selectCount = async () =>
    Number(
      (
        await db.query("SELECT reserved FROM delivery_slots WHERE id=$1", [
          slotId,
        ])
      ).rows[0].reserved,
    );
  const bookedBefore = await selectCount();
  await page
    .getByText("Пробна поръчка без доставка и плащане.", {exact: true})
    .waitFor();
  await page.locator("input[name=name]").fill(testName);
  await page.locator("input[name=phone]").fill("0000000000");
  await page.locator("input[name=street]").fill("Тестов адрес 1");
  await page.waitForFunction(
    () => document.querySelector(".total-line dt")?.textContent === "Общо",
  );
  await page.getByRole("checkbox", { name: /Прегледах сумите/ }).check();
  const whenSubmitted = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/orders" &&
      r.request().method() === "POST",
  );
  await page
    .locator("button[type=submit]")
    .filter({ hasText: /поръч/i })
    .click();
  const submitted = await whenSubmitted;
  const response = await submitted.json();
  assert.ok(submitted.ok(), response.error);
  receipt = response;
  const body = submitted.request().postDataJSON();
  await page.waitForURL("**/prosledyavane/*");
  await page.reload();
  await page.getByRole("heading", { name: /Поръчката е получена/ }).waitFor();
  await page
    .getByText("Пробна поръчка без доставка и плащане.", {exact: true})
    .waitFor();
  assert.equal(body.items.length, 56);
  const replay = await post("/api/orders", body);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, receipt);
  const emptyChoice = {
    ...body,
    items: body.items.map((i) => ({ ...i, requestedVariant: "" })),
  };
  const invalid = await post("/api/quote", emptyChoice);
  assert.ok(
    invalid.status === 400 || invalid.status === 409,
    "Сървърът прие неуточнен вариант",
  );
  assert.match(invalid.body.error, /вкус|вариант|размер/i);
  const later = (
    await db.query(
      "SELECT id FROM delivery_slots WHERE zone_id=$1 AND day>$2::date ORDER BY day LIMIT 1",
      [zoneId, entries[0].ends],
    )
  ).rows[0];
  assert.ok(later, "Липсва реален тестов интервал след края на брошурата");
  const expiry = await post("/api/quote", { ...body, slotId: later.id });
  assert.ok(
    expiry.status === 400 || expiry.status === 409,
    "Приета е изтекла цена",
  );
  assert.match(expiry.body.error, /срок|кампани/i);
  const [order] = (
    await db.query("select * from orders where idempotency_key=$1", [
      body.idempotencyKey,
    ])
  ).rows;
  assert.ok(order.test_only);
  assert.equal(order.customer.name, testName);
  assert.equal(order.status, "new");
  assert.equal(order.number, receipt.number);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from notification_jobs where order_id=$1 and channel in ('email','sms') and status='sent'",
        [order.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(await selectCount(), bookedBefore + 1);
  const { rows: lines } = await db.query(
    "select variant_id,snapshot,quantity,unit_cents,line_cents from order_items where order_id=$1",
    [order.id],
  );
  assert.equal(lines.length, entries.length);
  let subtotal = 0;
  for (const e of entries) {
    const line = lines.find((l) => l.variant_id === e.id);
    assert.ok(line, e.name);
    assert.equal(line.unit_cents, e.cents);
    const quantity = Number(line.quantity);
    const cents =
      e.buy > 1
        ? (Math.floor(quantity / e.buy) * e.pay + (quantity % e.buy)) * e.cents
        : Math.round(e.cents * quantity);
    assert.equal(line.line_cents, cents, e.name);
    assert.equal(
      Boolean(line.snapshot.food?.ageRestricted),
      Boolean(e.restricted),
      e.name,
    );
    if (choices.has(e.id)) {
      assert.equal(line.snapshot.requestedVariant, choices.get(e.id));
      assert.equal(line.snapshot.variantName, choices.get(e.id));
    }
    subtotal += cents;
  }
  assert.equal(order.subtotal_cents, subtotal);
  assert.equal(
    order.total_cents,
    subtotal + order.delivery_cents + order.extra_cents,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int AS n from orders where customer->>'name'=$1",
        [testName],
      )
    ).rows[0].n,
    1,
  );
  const cancelled = await post("/api/tracking/" + receipt.token, {
    action: "cancel",
    reason: "Приключена локална проверка.",
  });
  assert.equal(cancelled.status, 200);
  assert.equal(
    (await db.query("select status from orders where id=$1", [order.id]))
      .rows[0].status,
    "cancelled",
  );
  assert.equal(await selectCount(), bookedBefore);
  receipt = null;
  assert.deepEqual(errors, []);
  const evidence = {
    date: new Date().toISOString(),
    orderNumber: order.number,
    testOnly: order.test_only,
    products: lines.length,
    requestedVariants: choices.size,
    bundles: entries.filter((e) => e.buy > 1).length,
    weightedProducts: entries.filter((e) => e.unit === "kg").length,
    ageRestricted: entries.filter((e) => e.restricted).length,
    subtotalCents: subtotal,
    totalCents: order.total_cents,
    replayProducedSameOrder: true,
    missingVariantRejected: true,
    expiredPriceRejected: true,
    cancelled: true,
    slotReleased: true,
  };
  await mkdir("var/qa", { recursive: true });
  await writeFile(
    "var/qa/brochure-checkout.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(evidence);
} finally {
  try {
    if (receipt?.token)
      await post("/api/tracking/" + receipt.token, {
        action: "cancel",
        reason: "Приключена локална проверка.",
      });
  } finally {
    await browser?.close();
    await db.end();
  }
}
