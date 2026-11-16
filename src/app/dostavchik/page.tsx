import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/auth/access";
import { query } from "@/db";
import { PageHeading, Panel, Empty, Pill } from "@/admin/presentation";
import {
  DeliveryActions,
  MoneyAction,
  address,
  interval,
} from "@/admin/order-ui";
import { money, label } from "@/admin/format";
import "../admin/admin.css";
import { CourierLogout } from "@/admin/courier-logout";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Моите доставки · Микаела",
  robots: { index: false, follow: false },
};
export default async function CourierPage() {
  const actor = await requireStaff(["courier"]);
  const rows = await query(
    `select o.id,o.number,o.test_only,o.customer-'email'-'note' as customer,o.delivery_snapshot,o.total_cents,o.payment_status,o.payment_method,o.status,
 (select coalesce(sum(amount_cents),0)::int from payments p where p.order_id=o.id) balance,
 exists(select 1 from order_items i where i.order_id=o.id and i.status<>'missing' and coalesce(i.change_detail->'prepared'->'food'->>'ageRestricted',i.snapshot->'food'->>'ageRestricted')='true') age
 from orders o where o.assigned_to=$1 and (o.status in('ready','on_route','problem') or o.status='delivered' and o.payment_status not in('paid','refunded')) order by o.delivery_snapshot->>'day',o.delivery_snapshot->>'start_time',o.number`,
    [actor.id],
  );
  return (
    <div className="adm-root">
      <main className="adm-main" style={{ maxWidth: 750, margin: "auto" }}>
        <PageHeading
          title="Моите доставки"
          subtitle={actor.name}
          action={<CourierLogout />}
        />
        {actor.roles.some((r) => ["staff", "owner"].includes(r)) && (
          <Link className="adm-link" href="/admin">
            Работно табло
          </Link>
        )}
        {rows.length === 0 && (
          <Empty>Нямаш възложени доставки за изпълнение или отчитане.</Empty>
        )}
        {rows.map((o) => (
          <Panel title={"Поръчка № " + o.number} key={o.id}>
            <Pill value={o.status} /> <Pill value={o.payment_status} />
            {o.test_only && <p><strong>Тестова поръчка · Без реална доставка или плащане</strong></p>}
            <h3 style={{ marginTop: 12 }}>{o.customer.name}</h3>
            <p>
              {address(o)}
              <br />
              {interval(o)}
            </p>
            {o.customer.directions && <p>{o.customer.directions}</p>}
            {!o.test_only && <div className="adm-actions">
              <a href={"tel:" + o.customer.phone} className="adm-btn alt">
                Обаждане · {o.customer.phone}
              </a>
              <a
                href={
                  "https://www.google.com/maps/search/?api=1&query=" +
                  encodeURIComponent(address(o))
                }
                rel="noreferrer"
                target="_blank"
                className="adm-btn alt"
              >
                Навигация
              </a>
            </div>}
            <p>
              <strong>
                За получаване · {money(o.total_cents - o.balance)}
              </strong>{" "}
              · {label(o.payment_method)}
            </p>
            <DeliveryActions o={o} age={o.age} />
            {["on_route", "problem", "delivered"].includes(o.status) &&
              o.balance < o.total_cents && (
                <MoneyAction o={o} balance={o.balance} />
              )}
          </Panel>
        ))}
      </main>
    </div>
  );
}
