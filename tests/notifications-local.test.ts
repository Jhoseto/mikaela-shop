import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {createServer, type AddressInfo} from 'node:net';
import test from 'node:test';
import {Client} from 'pg';

// A loopback-only mailbox. Accept DATA only after the sender and recipient have
// been checked, and retain the message exactly as received from Nodemailer.
async function openMailbox(sender: string, recipient: string) {
  const messages: string[] = [];
  let rejectWith = '';
  const server = createServer(socket => {
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    let pending = '', envelopeSender = false, envelopeRecipient = false;
    let data: string[] | undefined;
    const reply = (line: string) => socket.write(line + '\r\n');
    reply('220 localhost ESMTP test mailbox');
    socket.on('data', chunk => {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf('\r\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data) {
          if (line !== '.') { data.push(line.replace(/^\.\./, '.')); continue; }
          if (rejectWith) reply('451 ' + rejectWith);
          else { messages.push(data.join('\r\n')); reply('250 2.0.0 saved'); }
          data = undefined;
        } else if (/^(EHLO|HELO) /i.test(line)) {
          reply('250 localhost');
        } else if (line === 'MAIL FROM:<' + sender + '>') {
          envelopeSender = true;
          reply('250 sender OK');
        } else if (envelopeSender && line === 'RCPT TO:<' + recipient + '>') {
          envelopeRecipient = true;
          reply('250 recipient OK');
        } else if (line === 'DATA' && envelopeRecipient) {
          data = [];
          reply('354 End with a dot');
        } else if (line === 'QUIT') {
          socket.end('221 Goodbye\r\n');
        } else {
          reply('550 5.1.1 unknown command or envelope address');
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    messages,
    url: 'smtp://127.0.0.1:' + (server.address() as AddressInfo).port,
    reject(message: string) { rejectWith = message; },
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  };
}

function receiptText(message: string) {
  const split = message.indexOf('\r\n\r\n');
  assert.ok(split >= 0, 'Полученото писмо има заглавки и тяло.');
  const headers = message.slice(0, split);
  const body = message.slice(split + 4);
  if (/^Content-Transfer-Encoding: base64/im.test(headers)) return Buffer.from(body, 'base64').toString('utf8');
  if (/^Content-Transfer-Encoding: quoted-printable/im.test(headers)) {
    const decoded = body.replace(/=\r\n/g, '').replace(/=([a-f0-9]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(decoded, 'latin1').toString('utf8');
  }
  return body;
}

test('Известия: локална SMTP доставка, Twilio заявка, безопасен журнал и повторно изпращане', {timeout: 60000}, async t => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Изисква се локална тестова база.');
  const dbName = 'mikaela_notify_' + randomUUID().replaceAll('-', '');
  url.pathname = '/postgres';
  const admin = new Client({connectionString: url.href});
  await admin.connect();
  await admin.query('CREATE DATABASE "' + dbName + '"');
  url.pathname = '/' + dbName;
  const customer = {name: 'Учебен купувач', phone: '+15005550006', email: 'buyer@example.invalid', street: 'Учебна улица 14'};
  const sender = 'shop@example.invalid';
  const sid = 'AC' + randomBytes(16).toString('hex');
  const password = randomBytes(24).toString('hex');
  const basic = Buffer.from(sid + ':' + password).toString('base64');
  const mailbox = await openMailbox(sender, customer.email);
  const config = {
    DATABASE_URL: url.href, NOTIFICATION_MODE: 'live', APP_URL: 'https://shop.example.invalid',
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), MAIL_FROM: sender, SMTP_URL: mailbox.url,
    SMS_TWILIO_ACCOUNT_SID: sid, SMS_TWILIO_AUTH_TOKEN: password, SMS_FROM: '+15005550007'
  };
  const previous = new Map(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  let closePool: (() => Promise<void>) | undefined;
  try {
    const migration = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {encoding: 'utf8', windowsHide: true});
    assert.equal(migration.status, 0, 'Миграциите трябва да бъдат приложени в новата тестова база.');
    const {pool, query} = await import('../src/db');
    closePool = () => pool.end();
    const {quote, submit} = await import('../src/commerce/checkout');
    const {sendNotifications} = await import('../src/commerce/notifications');
    assert.equal((await query("SELECT path FROM migrations WHERE path='migrations/007-offer-groups.sql'")).length, 1);
    const terms = 'Учебен текст на условията за потвърждението.';
    await query("UPDATE settings SET value=$1 WHERE key='site'", [{demo: true, ordersOpen: true, notificationSms: true, company: 'Учебен продавач'}]);
    await query("INSERT INTO pages(slug,published,version) VALUES('obshti-usloviya',$1,7)", [{body: terms}]);
    const [category] = await query("INSERT INTO categories(slug,name) VALUES('test','Учебна категория') RETURNING id");
    const [product] = await query("INSERT INTO products(slug,name,status,category_id,food) VALUES('test','Учебен продукт','published',$1,$2) RETURNING id", [category.id, {type: 'nonfood'}]);
    const [variant] = await query("INSERT INTO variants(product_id,name,pack,unit,regular_cents) VALUES($1,'Вариант','2 бр.','piece',250) RETURNING id", [product.id]);
    const [zone] = await query("INSERT INTO delivery_zones(name,fee_cents) VALUES('Учебен район',100) RETURNING id");
    const [slot] = await query("INSERT INTO delivery_slots(zone_id,day,start_time,end_time,capacity) VALUES($1,(now() at time zone 'Europe/Sofia')::date+1,'15:00','16:00',2) RETURNING id", [zone.id]);
    const cart = {zoneId: zone.id, slotId: slot.id, payment: 'cash' as const, items: [
      {variantId: variant.id, quantity: 2, substitution: 'skip' as const, note: '', weightTolerance: 0}
    ]};
    const price = await quote(cart);
    const order = await submit({...cart, customer, quoteSignature: price.signature, termsVersion: price.termsVersion, idempotencyKey: randomUUID()});
    const title = 'Поръчката е получена № ' + order.number;
    const link = config.APP_URL + '/prosledyavane/' + order.token;
    const diagnostic = [customer.name, customer.phone, customer.email, customer.street, password, basic, order.token].join(' ');
    const calls: Request[] = [];
    let failProvider = true;
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      if (failProvider) throw Error(diagnostic);
      return new Response('{"sid":"SM-local-only"}', {status: 201});
    });
    const output: string[] = [];
    async function dispatch() {
      const capture = (chunk: string | Uint8Array) => { output.push(Buffer.from(chunk).toString()); return true; };
      const stdout = t.mock.method(process.stdout, 'write', capture);
      const stderr = t.mock.method(process.stderr, 'write', capture);
      try { return await sendNotifications(); }
      finally { stdout.mock.restore(); stderr.mock.restore(); }
    }
    mailbox.reject(diagnostic);
    assert.equal(await dispatch(), 3);
    assert.equal(mailbox.messages.length, 0);
    const failed = await query("SELECT channel,status,attempts,last_error FROM notification_jobs WHERE channel IN ('email','sms') ORDER BY channel");
    assert.equal(failed.length, 2);
    for (const job of failed) {
      assert.equal(job.status, 'retry');
      assert.equal(job.attempts, 1);
      assert.ok(job.last_error && !job.last_error.includes(diagnostic));
    }
    failProvider = false;
    mailbox.reject('');
    await query("UPDATE notification_jobs SET next_at=now() WHERE status='retry'");
    assert.equal(await dispatch(), 2);
    assert.equal(await dispatch(), 0);
    assert.equal(calls.length, 2);
    assert.equal(mailbox.messages.length, 1);
    const jobs = await query('SELECT id,channel,status,attempts,last_error,payload FROM notification_jobs ORDER BY channel');
    assert.deepEqual(jobs.map(j => [j.channel, j.status, j.attempts]), [['email','sent',2], ['print','print_ready',1], ['sms','sent',2]]);
    assert.equal((await query('SELECT count(*)::int n FROM orders'))[0].n, 1);
    const receipt = receiptText(mailbox.messages[0]);
    for (const text of [title, 'Учебен продавач', customer.name, customer.street, 'Учебен продукт', 'Вариант', 'Учебен район', 'Общо: 6,00', 'в брой', link, 'Общи условия, версия 7', terms]) {
      assert.ok(receipt.includes(text), 'Потвърждението съдържа артикулите, сумите, продавача, доставката, условията и защитената връзка.');
    }
    assert.ok(mailbox.messages[0].includes('Message-ID: <' + jobs[0].id + '@mikaela.local>'));
    for (const request of calls) {
      assert.ok(request.url === 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json');
      assert.equal(request.method, 'POST');
      assert.ok(request.headers.get('authorization') === 'Basic ' + basic);
      assert.match(request.headers.get('content-type') || '', /application\/x-www-form-urlencoded/);
      const fields = new URLSearchParams(await request.text());
      assert.equal(fields.get('From'), config.SMS_FROM);
      assert.equal(fields.get('To'), customer.phone);
      assert.ok(fields.get('Body') === title + '. ' + link);
    }
    const audits = await query('SELECT action,entity,detail FROM audit_log');
    const logs = JSON.stringify([...output, ...failed, ...audits, ...jobs.filter(j => j.channel !== 'print')]);
    for (const value of [customer.name, customer.phone, customer.email, customer.street, order.token, sid, basic, password, config.BETTER_AUTH_SECRET]) {
      assert.ok(!logs.includes(value), 'Диагностиката и записите за изпращане не разкриват лични данни и ключове.');
    }
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await mailbox.close();
    await closePool?.();
    try { await admin.query('DROP DATABASE "' + dbName + '"'); }
    finally { await admin.end(); }
  }
});
