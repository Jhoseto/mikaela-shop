import { priceNeedsReview } from "@/admin/price-check";
import Link from "next/link";
import { query } from "@/db";
import { requireStaff } from "@/auth/access";
import { getSettings } from "@/commerce/catalog";
import { PageHeading, Panel, Open } from "@/admin/presentation";
import { CommandForm, Submit } from "@/admin/widgets";
import { liveStats } from "@/admin/live";
import { LiveNotice } from "@/admin/live-notice";
import { money, dateTime, label } from "@/admin/format";
export default async function Dashboard() {
  const staff = await requireStaff(["staff"]);
  const [stats, summary, recent, site] = await Promise.all([
    liveStats(),
    query(
      `select (select count(*) from orders where status='preparing') preparing,(select count(*) from orders where status='waiting') waiting,(select count(*) from orders o join delivery_slots s on s.id=o.slot_id where s.day=(now() at time zone 'Europe/Sofia')::date and o.status<>'cancelled') today,(select count(*) from brochure_items i join brochure_campaigns c on c.current_batch=i.batch_id where status='review') review,(select count(*) from notification_jobs where last_error is not null and status<>'sent') failed,(select count(*) from brochure_schedule where last_error is not null) sync_error,(select count(distinct p.id) from variants v join products p on p.id=v.product_id where p.status='published' and ${priceNeedsReview}) missing_price`,
    ),
    query(
      "select id,number,status,total_cents,created_at,test_only from orders order by created_at desc limit 8",
    ),
    getSettings(),
  ]);
  const a = summary[0],
    statsLinks = [
      ["Нови поръчки", stats.fresh, "/admin/orders?status=new"],
      ["В подготовка", a.preparing, "/admin/orders?status=preparing"],
      ["Чакат клиента", a.waiting, "/admin/orders?status=waiting"],
      ["Доставки днес", a.today, "/admin/orders?today=1"],
      ["За преглед в брошурата", a.review, "/admin/broshuri"],
      [
        "За уточняване на цена",
        a.missing_price,
        "/admin/products?status=published&issue=price",
      ],
    ];
  return (
    <>
      <PageHeading
        title="Работно табло"
        subtitle={site.demo ? "Демонстрационна среда" : site.name}
        action={<Open href="/admin/products/nov">Добави продукт</Open>}
      />
      <LiveNotice initial={stats} />
      <div className="adm-grid" style={{ marginTop: 20 }}>
        {statsLinks.map(([name, num, href], i) => (
          <Link
            key={name}
            href={String(href)}
            className={"adm-stat " + (i === 0 ? "warm" : "")}
          >
            <strong>{num}</strong>
            {name}
          </Link>
        ))}
      </div>
      <Panel title="Последни поръчки">
        {recent.length ? (
          <ul className="adm-list">
            {recent.map((o) => (
              <li key={o.id}>
                <Link className="adm-link" href={"/admin/orders/" + o.id}>
                  № {o.number}
                </Link>{" "}
                · {dateTime(o.created_at)} · {label(o.status)} ·{" "}
                {money(o.total_cents)}{o.test_only && " · Тестова поръчка"}
              </li>
            ))}
          </ul>
        ) : (
          <p>Все още няма поръчки.</p>
        )}
      </Panel>
      <Panel title="Състояние на магазина">
        <p>
          {site.localBrochureOrdering ? "Локални тестови поръчки" : "Нови поръчки"} · {site.ordersOpen ? "приемат се" : "временно спрени"}
        </p>
        <p>
          <Link href="/admin/notifications" className="adm-link">
            Затруднения с известяването · {a.failed}
          </Link>{" "}
          · Синхронизация ·{" "}
          {Number(a.sync_error) ? "нужен е преглед" : "без регистрирана грешка"}
        </p>
        {staff.roles.includes("owner") && site.ordersOpen && (
          <CommandForm
            command="settings.pause"
            confirm="Да се спрат ли временно новите поръчки?"
          >
            <Submit secondary>Спри временно новите поръчки</Submit>
          </CommandForm>
        )}
      </Panel>
    </>
  );
}
