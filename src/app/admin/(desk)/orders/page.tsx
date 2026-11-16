import Link from "next/link";
import { requireStaff } from "@/auth/access";
import { query } from "@/db";
import { PageHeading, Panel, Pill, Empty } from "@/admin/presentation";
import { Field } from "@/admin/widgets";
import { money, label } from "@/admin/format";
import { interval } from "@/admin/order-ui";
import { liveStats } from "@/admin/live";
import { LiveNotice } from "@/admin/live-notice";
export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireStaff(["staff"]);
  const d = await searchParams;
  const page = Math.max(1, Math.min(10000, Number(d.page) || 1));
  const [rows, stats] = await Promise.all([
    query(
      `select id, number,status,payment_status,customer,delivery_snapshot,total_cents,count(*) over() total_count from orders where ($1='' or status=$1) and ($2='' or number::text=$2 or position(lower($2) in lower(customer->>'name'))>0 or position($2 in customer->>'phone')>0) and ($3<>'1' or (delivery_snapshot->>'day')::date=(now() at time zone 'Europe/Sofia')::date) order by created_at desc limit 40 offset $4`,
      [
        d.status || "",
        String(d.q || "").slice(0, 120),
        d.today || "",
        40 * (page - 1),
      ],
    ),
    liveStats(),
  ]);
  return (
    <>
      <PageHeading title="Поръчки" />
      <LiveNotice initial={stats} />
      <Panel>
        <form className="adm-filter">
          <Field title="Номер, име или телефон">
            <input type="search" name="q" defaultValue={d.q} />
          </Field>
          <Field title="Статус">
            <select name="status" defaultValue={d.status || ""}>
              <option value="">Всички</option>
              {[
                "new",
                "confirmed",
                "preparing",
                "waiting",
                "ready",
                "on_route",
                "problem",
                "delivered",
                "cancelled",
              ].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
          <label className="adm-check">
            <input
              type="checkbox"
              name="today"
              value="1"
              defaultChecked={d.today === "1"}
            />
            Днес
          </label>
          <button className="adm-btn">Търси</button>
        </form>
      </Panel>
      <Panel>
        {rows.length ? (
          <div className="adm-tablewrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Поръчка</th>
                  <th>Клиент</th>
                  <th>Доставка</th>
                  <th>Сума</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={"/admin/orders/" + o.id}>№ {o.number}</Link>
                    </td>
                    <td>{o.customer.name}</td>
                    <td>{interval(o)}</td>
                    <td>{money(o.total_cents)}</td>
                    <td>
                      <Pill value={o.status} />{" "}
                      <Pill value={o.payment_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Няма поръчки по тези критерии.</Empty>
        )}
        <div className="adm-actions">
          {page > 1 && (
            <Link
              className="adm-btn alt"
              href={
                "/admin/orders?" +
                new URLSearchParams({ ...d, page: String(page - 1) })
              }
            >
              Предишна
            </Link>
          )}
          {page * 40 < Number(rows[0]?.total_count) && (
            <Link
              className="adm-btn alt"
              href={
                "/admin/orders?" +
                new URLSearchParams({ ...d, page: String(page + 1) })
              }
            >
              Следваща
            </Link>
          )}
        </div>
      </Panel>
    </>
  );
}
