import nodemailer from "nodemailer";
import { query } from "@/db";
import { tokenFor } from "./checkout";
import { lineName } from "./order-line";
const money = (c: number) =>
  new Intl.NumberFormat("bg-BG", { style: "currency", currency: "EUR" }).format(
    c / 100,
  );
export function smsNumber(input: string) {
  let phone = input.replace(/[\s()-]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  else if (phone.startsWith("0")) phone = "+359" + phone.slice(1);
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw Error("sms-phone-format");
  return phone;
}
export async function sendNotifications(limit = 20) {
  let processed = 0;
  while (processed < limit) {
    const [job] = await query(
      `UPDATE notification_jobs SET status='sending',attempts=attempts+1,next_at=now()+interval '4 minutes' WHERE id=(SELECT id FROM notification_jobs WHERE status IN ('pending','retry','sending') AND next_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    );
    if (!job) break;
    processed++;
    try {
      const [o] = await query("SELECT * FROM orders WHERE id=$1", [
        job.order_id,
      ]);
      const items = await query(
        "SELECT * FROM order_items WHERE order_id=$1 ORDER BY id",
        [o.id],
      );
      const [config] = await query(
        "SELECT value FROM settings WHERE key='site'",
      );
      const site = o.terms_snapshot.seller || config?.value || {};
      const receipt = job.kind === "received",
        slot = receipt
          ? job.payload.slot || o.delivery_snapshot
          : o.delivery_snapshot;
      const track =
        (process.env.APP_URL || "http://localhost:3000") +
        "/prosledyavane/" +
        tokenFor(o.id);
      const details = items
        .map((i) => {
          const s = receipt
            ? i.snapshot
            : i.change_detail.prepared || i.snapshot;
          const terms = !receipt && i.status === "replaced" ? s.offer?.terms : s.terms;
          return (
            s.productName +
            " · " +
            s.variantName +
            " · " +
            s.pack +
            " — " +
            (receipt ? i.quantity : (i.prepared_quantity ?? i.quantity)) +
            " " +
            (s.unit === "kg" ? "кг" : "бр.") +
            " × " +
            money(s.unitCents) +
            " = " +
            money(receipt ? i.original_cents : i.line_cents) +
            (terms ? " (" + terms + ")" : "")
          );
        })
        .join("\n");
      const terms = o.terms_snapshot;
      let recipient = job.payload.recipient || o.customer.email;
      const labels: Record<string, string> = {
        received: "Поръчката е получена",
        confirmed: "Поръчката е потвърдена",
        ready: "Поръчката е готова",
        delivered: "Поръчката е доставена",
        cancelled: "Поръчката е отменена",
        withdraw: "Получен е отказ от договора",
        claim: "Получена е рекламация",
      };
      const title =
        (labels[job.kind] || "Промяна в поръчката") + " № " + o.number;
      let content = [
        title,
        site.company || site.name,
        site.companyId,
        site.address,
        site.phone,
        o.customer.name,
        o.customer.street,
        slot.name +
          " · " +
          slot.day +
          " " +
          slot.start_time +
          "–" +
          slot.end_time,
        details,
        "Доставка: " + money(o.delivery_cents),
        "Допълнителни такси: " + money(o.extra_cents),
        "Общо: " + money(receipt ? o.original_cents : o.total_cents),
        "Плащане при доставка: " +
          (o.payment_method === "cash" ? "в брой" : "с карта"),
        "Проследяване: " + track,
        "Общи условия, версия " + o.terms_version,
        typeof terms.body === "string" ? terms.body : JSON.stringify(terms),
      ]
        .filter(Boolean)
        .join("\n");
      if (job.kind === "staff_received")
        content = "Нова поръчка № " + o.number + ". Отворете служебното табло.";
      if (job.payload.claimId) {
        const [claim] = await query("SELECT * FROM claims WHERE id=$1", [
          job.payload.claimId,
        ]);
        if (claim) {
          recipient = claim.contact.email || recipient;
          content =
            title +
            "\n" +
            new Intl.DateTimeFormat("bg-BG", {
              timeZone: "Europe/Sofia",
              dateStyle: "full",
              timeStyle: "medium",
            }).format(claim.created_at) +
            "\n" +
            (claim.contact.name || o.customer.name) +
            "\n" +
            claim.item_details.map(lineName).join(", ") +
            "\n" +
            claim.reason +
            "\n" +
            track;
        }
      }
      const mode = process.env.NOTIFICATION_MODE || "test";
      let status = "sent";
      if (job.channel === "print") {
        status = "print_ready";
      } else if (mode === "test") {
        status = "test_captured";
      } else if (job.channel === "email") {
        if (!process.env.SMTP_URL || !process.env.MAIL_FROM || !recipient)
          throw Error("mail-configuration");
        const smtp = nodemailer.createTransport(process.env.SMTP_URL);
        try {
          await smtp.sendMail({
            from: process.env.MAIL_FROM,
            to: recipient,
            subject: title,
            text: content,
            messageId: "<" + job.id + "@mikaela.local>",
          });
        } finally {
          smtp.close();
        }
      } else if (job.channel === "sms") {
        const sid = process.env.SMS_TWILIO_ACCOUNT_SID,
          pass = process.env.SMS_TWILIO_AUTH_TOKEN,
          from = process.env.SMS_FROM;
        if (!sid || !pass || !from) throw Error("sms-configuration");
        const res = await fetch(
          "https://api.twilio.com/2010-04-01/Accounts/" +
            encodeURIComponent(sid) +
            "/Messages.json",
          {
            method: "POST",
            headers: {
              Authorization:
                "Basic " + Buffer.from(sid + ":" + pass).toString("base64"),
            },
            body: new URLSearchParams({
              From: from,
              To: smsNumber(o.customer.phone),
              Body: title + ". " + track,
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!res.ok) throw Error("sms-service");
      } else throw Error("unknown-channel");
      await query(
        "UPDATE notification_jobs SET status=$2,last_error=null,payload=payload||$3::jsonb WHERE id=$1",
        [
          job.id,
          status,
          JSON.stringify(
            status === "print_ready" || status === "test_captured"
              ? { document: content }
              : {},
          ),
        ],
      );
    } catch {
      await query(
        "UPDATE notification_jobs SET status=CASE WHEN attempts>=6 THEN 'failed' ELSE 'retry' END,last_error='Проверете доставчика и настройките.',next_at=now()+make_interval(mins=>least(60,attempts*attempts)) WHERE id=$1",
        [job.id],
      );
    }
  }
  return processed;
}
