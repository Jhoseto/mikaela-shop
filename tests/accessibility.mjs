import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from '@playwright/test';
import sharp from 'sharp';

const origin = new URL(process.env.SHOP_TEST_URL || 'http://localhost:3100');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname));
const axe = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const file = path.resolve('var/qa/accessibility.json');
await fs.mkdir(path.dirname(file), {recursive: true});
const browser = await chromium.launch({
  ...(process.env.TEST_BROWSER_PATH ? {executablePath: process.env.TEST_BROWSER_PATH} : process.platform === 'win32' ? {channel: 'chrome'} : {}),
  headless: true
});
const report = {date: new Date().toISOString(), browser: browser.version(), scans: [], contrast: [], keyboard: [], orderRequests: 0, complete: false};
const save = () => fs.writeFile(file, JSON.stringify(report, null, 2));

async function scan(page, viewport, screen) {
  if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({path: axe});
  const result = await page.evaluate(async () => {
    await document.fonts.ready;
    const {violations, incomplete, testEngine} = await window.axe.run(document, {
      runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']},
      resultTypes: ['violations','incomplete']
    });
    return {
      engine: testEngine.version,
      violations: violations.map(({id, impact, nodes}) => ({
        id, impact, count: nodes.length, examples: nodes.slice(0, 4).map(n => ({target: n.target, summary: n.failureSummary}))
      })),
      manual: incomplete.map(({id, nodes}) => ({id, count: nodes.length, examples: nodes.slice(0, 3).map(n => ({target:n.target, reason:n.failureSummary}))}))
    };
  });
  report.scans.push({viewport, screen, ...result});
  console.log(viewport, screen, result.violations.map(v => v.id + ' × ' + v.count).join(', ') || 'OK');
  await save();
}

function keyboard(viewport, step, passed, evidence = null) {
  report.keyboard.push({viewport, step, passed, evidence});
  if (!passed) console.log(viewport, step, 'FAIL', evidence);
}

async function tabTo(page, target, {reverse = false, limit = 200} = {}) {
  await target.waitFor({state: 'visible'});
  for (let n = 0; n < limit; n++) {
    if (await target.evaluate(el => document.activeElement === el)) return;
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
  }
  throw Error('Контролата е извън реда за навигация с клавиатура: ' + target);
}

// Axe cannot determine backgrounds composed with a pseudo-element or image.
// Measure the rendered background under each letter of the main shopping actions.
async function measureContrast(page, viewport, selector) {
  const target = page.locator(selector).first();
  if (!await target.isVisible()) return;
  await target.evaluate(el => el.scrollIntoView({block:'center', behavior:'instant'}));
  const samples = await target.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    const result = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const style = getComputedStyle(node.parentElement);
      const ink = style.color.match(/[\d.]+/g).map(Number);
      const font = parseFloat(style.fontSize);
      const large = font >= 24 || (font >= 18.66 && parseFloat(style.fontWeight) >= 700);
      for (let i = 0; i < node.length; i++) {
        if (!node.textContent[i].trim()) continue;
        const range = new Range();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect();
        const x = box.left + box.width / 2, y = box.top + box.height / 2;
        if (box.width > 0 && box.height > 0 && el.contains(document.elementFromPoint(x,y))) {
          result.push({x: Math.floor(x - bounds.left), y: Math.floor(y - bounds.top), ink, limit: large ? 3 : 4.5});
        }
      }
    }
    return result;
  });
  const style = await page.addStyleTag({content: selector + ', ' + selector + ' * { -webkit-text-fill-color:transparent !important; text-shadow:none !important; }'});
  let pixels;
  try { pixels = await sharp(await target.screenshot()).removeAlpha().raw().toBuffer({resolveWithObject: true}); }
  finally { await style.evaluate(node => node.remove()); }
  const lum = rgb => {
    const linear = rgb.map(c => c/255 <= 0.04045 ? c/255/12.92 : ((c/255 + 0.055)/1.055)**2.4);
    return linear[0]*0.2126 + linear[1]*0.7152 + linear[2]*0.0722;
  };
  let lowest = Infinity, failures = 0;
  for (const {x,y,ink,limit} of samples) {
    const index = (y*pixels.info.width + x)*pixels.info.channels;
    const background = [...pixels.data.subarray(index,index+3)];
    const alpha = ink[3] ?? 1;
    const fg = lum(ink.slice(0,3).map((v,i) => v*alpha + background[i]*(1-alpha)));
    const bg = lum(background);
    const ratio = (Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05);
    lowest = Math.min(lowest,ratio);
    if (ratio < limit) failures++;
  }
  report.contrast.push({viewport,selector,letters:samples.length,minimumRatio:samples.length ? Number(lowest.toFixed(2)) : null,failures});
}

try {
  for (const [viewport, width, height] of [['desktop',1440,960],['mobile',390,844]]) {
    const context = await browser.newContext({viewport: {width,height}, locale: 'bg-BG', timezoneId: 'Europe/Sofia', reducedMotion: 'reduce', bypassCSP: true, hasTouch: viewport === 'mobile'});
    try {
      await context.route('**/api/orders', route => {
        if (route.request().method() !== 'POST') return route.continue();
        report.orderRequests++;
        return route.abort();
      });
      const p = await context.newPage();
      const goto = async route => {
        const response = await p.goto(new URL(route, origin).href, {waitUntil: 'networkidle'});
        assert.equal(response?.status(), 200, route);
      };
      await goto('/');
      await p.getByText('Демонстрационен магазин', {exact: true}).waitFor();
      await scan(p, viewport, 'home');
      await p.keyboard.press('Tab');
      const skip = p.locator('.skip-link');
      await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const firstFocus = await skip.evaluate(el => ({
        active: document.activeElement === el,
        top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom,
        outline: getComputedStyle(el).outline, focusedElement: document.activeElement.outerHTML.slice(0,100)
      }));
      keyboard(viewport, 'Видим първи фокус върху пропускане към съдържанието', firstFocus.active && firstFocus.top < height && firstFocus.bottom > 0, firstFocus);
      await p.keyboard.press('Enter');
      keyboard(viewport, 'Прескачане в основното съдържание', await p.locator('#main-shop').evaluate(el => el === document.activeElement));
      for (const selector of ['.hero-copy h1','.hero-copy > p:not(.hero-kicker)','.hero-copy .shop-button','.product-card .add-button','.product-card .price-row strong']) await measureContrast(p, viewport, selector);
      const opener = p.getByRole('button', {name: /Провери района за доставка/});
      await tabTo(p, opener, {reverse: true});
      await p.keyboard.press('Enter');
      const dialog = p.getByRole('dialog');
      await dialog.waitFor();
      const inside = () => dialog.evaluate(el => el.contains(document.activeElement));
      await p.waitForFunction(() => document.querySelector('[role=dialog]')?.contains(document.activeElement));
      const activeElements = [];
      let trapped = await inside();
      for (const key of ['Shift+Tab','Tab','Tab','Tab','Tab']) {
        await p.keyboard.press(key);
        await p.evaluate(() => new Promise(requestAnimationFrame));
        activeElements.push(await p.evaluate(() => document.activeElement.outerHTML.slice(0, 135)));
        trapped = trapped && await inside();
      }
      keyboard(viewport, 'Фокусът остава в отворения прозорец за район', trapped, activeElements);
      await scan(p, viewport, 'delivery dialog');
      await p.keyboard.press('Escape');
      await dialog.waitFor({state: 'hidden'});
      keyboard(viewport, 'Escape връща фокуса в бутона за района', await opener.evaluate(el => el === document.activeElement));
      await goto('/produkti');
      await scan(p, viewport, 'catalog');
      const card = p.locator('.product-card').filter({has: p.locator("button[aria-label^='Добави ']:enabled")}).first();
      const productLink = await card.locator('h3 a').getAttribute('href');
      await goto(productLink);
      await scan(p, viewport, 'product');
      const add = p.locator("button[aria-label^='Добави ']:enabled").first();
      await tabTo(p, add);
      await p.keyboard.press('Enter');
      await p.locator('.quantity-picker output').first().waitFor();
      keyboard(viewport, 'След добавяне фокусът остава при количеството', await p.evaluate(() => Boolean(document.activeElement.closest('.add-wrap'))));
      const decrease = p.getByRole('button', {name:/^Намали /}).first();
      await tabTo(p, decrease);
      await p.keyboard.press('Enter');
      await add.waitFor({state:'visible'});
      keyboard(viewport, 'Премахването на последната бройка връща фокуса на Добави', await add.evaluate(el => el === document.activeElement));
      await tabTo(p, add);
      await p.keyboard.press('Enter');
      await p.locator('.quantity-picker output').first().waitFor();
      await goto('/kolichka');
      await p.locator('.basket-row').first().waitFor();
      await scan(p, viewport, 'basket');
      const checkout = p.getByRole('link', {name: 'Към завършване'});
      await tabTo(p, checkout);
      await p.keyboard.press('Enter');
      await p.waitForURL('**/porachka');
      const zone = p.getByLabel('Населено място или район');
      await tabTo(p, zone);
      await zone.locator('option:nth-child(2)').waitFor({state: 'attached'});
      await p.keyboard.press('Home');
      await p.keyboard.press('ArrowDown');
      await p.keyboard.press('Tab');
      const slot = p.getByLabel('Ден и часови интервал');
      await slot.locator('option:nth-child(2)').waitFor({state: 'attached'});
      await tabTo(p, slot);
      await p.keyboard.press('Home');
      await p.keyboard.press('ArrowDown');
      await p.keyboard.press('Tab');
      await p.waitForFunction(() => document.querySelector('.total-line dt')?.textContent === 'Общо');
      await scan(p, viewport, 'checkout');
      for (const [name, value] of [['name','Учебен клиент'],['phone','0000000000'],['street','Учебна улица 1']]) {
        await tabTo(p, p.locator('input[name=' + name + ']'));
        await p.keyboard.insertText(value);
      }
      const consent = p.getByRole('checkbox', {name: /Прегледах сумите/});
      await tabTo(p, consent);
      await p.keyboard.press('Space');
      const submit = p.getByRole('button', {name:'Поръчвам с плащане при доставка'});
      await tabTo(p, submit);
      keyboard(viewport, 'Финалният бутон е достъпен от клавиатура и има видим фокус', await submit.evaluate(el =>
        !el.disabled && el === document.activeElement && el.matches(':focus-visible') && parseFloat(getComputedStyle(el).outlineWidth) > 0));
      await goto('/admin/login');
      await scan(p, viewport, 'staff login');
    } finally { await context.close(); }
  }
  report.complete = true;
} finally {
  await save();
  await browser.close();
}
assert.equal(report.orderRequests, 0);
assert.ok(report.keyboard.every(k => k.passed), 'Непреминали клавиатурни проверки: ' + report.keyboard.filter(k => !k.passed).map(k => k.viewport + ': ' + k.step).join(', '));
assert.ok(report.scans.every(s => !s.violations.length), 'Откритите нарушения са в ' + file);
assert.ok(report.contrast.every(c => c.letters > 0 && c.failures === 0), 'Проверете измерените контрасти в ' + file);
