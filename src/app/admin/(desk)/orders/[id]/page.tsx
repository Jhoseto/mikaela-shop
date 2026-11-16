import { notFound } from "next/navigation";
import { query } from "@/db";
import { requireStaff } from "@/auth/access";
import { delivery } from "@/commerce/checkout";
import { claimLine, lineName, type ClaimLine } from "@/commerce/order-line";
import { PageHeading, Panel, Pill } from "@/admin/presentation";
import { CommandForm, Field, Submit, PrintButton } from "@/admin/widgets";
import { label, money, dateTime } from "@/admin/format";
import {
  address,
  interval,
  OrderTotal,
  OrderAction,
  DeliveryActions,
  MoneyAction,
  ItemEditor,
  Channel,
} from "@/admin/order-ui";
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff(["staff"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [o] = await query(
    'select o.*,a.name assigned_name,s.name prepared_name from orders o left join "user" a on a.id=o.assigned_to left join "user" s on s.id=o.prepared_by where o.id=$1',
    [id],
  );
  if (!o) notFound();
  const open = !["delivered", "cancelled"].includes(o.status),
    editing = ["preparing", "waiting"].includes(o.status);
  const [items, claims, events, payments, couriers, variants, slots] =
    await Promise.all([
      query(
        "select * from order_items where order_id=$1 order by snapshot->>'category', snapshot->>'productName'",
        [id],
      ),
      query("select * from claims where order_id=$1 order by created_at", [id]),
      query(
        'select e.*,u.name actor_name from order_events e left join "user" u on u.id=e.actor where order_id=$1 order by e.id',
        [id],
      ),
      query(
        'select p.*,u.name actor_name from payments p left join "user" u on u.id=p.actor where order_id=$1 order by p.created_at',
        [id],
      ),
      open
        ? query(
            'select u.id,u.name from "user" u join staff_roles r on r.user_id=u.id where r.role=$1 order by u.name',
            ["courier"],
          )
        : [],
      editing
        ? query(
            `select v.id,v.name,v.pack,p.name product from variants v join products p on p.id=v.product_id
             where v.available and p.available and p.status='published'
             and (coalesce((p.food||v.food)->>'ageRestricted','false')<>'true'
               or exists(select 1 from settings where key='site' and value->>'ageEnabled'='true'))
             order by p.name,v.name`,
          )
        : [],
      open ? delivery(o.zone_id) : { slots: [] },
    ]);
  const balance = payments.reduce((a, r) => a + Number(r.amount_cents), 0);
  const age = items.some(
    (i) =>
      i.status !== "missing" &&
      (i.change_detail.prepared?.food || i.snapshot.food)?.ageRestricted,
  );
  return (
    <>
      <PageHeading
        title={"Поръчка № " + o.number}
        subtitle={dateTime(o.created_at)}
        action={
          <div className="adm-inline">
            <a
              className="adm-btn alt"
              href={"/admin/orders/" + id + "/print?mode=pick"}
              target="_blank"
              rel="noreferrer"
            >
              Списък за събиране
            </a>
            <a
              className="adm-btn"
              href={"/admin/orders/" + id + "/print"}
              target="_blank"
              rel="noreferrer"
            >
              Потвърждение за клиента
            </a>
          </div>
        }
      />
      <Pill value={o.status} /> <Pill value={o.payment_status} />
      <section className="adm-grid wide">
        <Panel title="Клиент и доставка">
          <dl className="adm-dl">
            <dt>Име</dt>
            <dd>{o.customer.name}</dd>
            <dt>Телефон</dt>
            <dd>
              <a href={"tel:" + o.customer.phone}>{o.customer.phone}</a>
            </dd>
            {o.customer.email && (
              <>
                <dt>Имейл</dt>
                <dd>{o.customer.email}</dd>
              </>
            )}
            <dt>Адрес</dt>
            <dd>{address(o)}</dd>
            <dt>Интервал</dt>
            <dd>{interval(o)}</dd>
            <dt>Начин на плащане</dt>
            <dd>{label(o.payment_method)}</dd>
            <dt>Подготвя</dt>
            <dd>{o.prepared_name || "—"}</dd>
            <dt>Доставчик</dt>
            <dd>{o.assigned_name || "—"}</dd>
          </dl>
          {o.customer.directions && <p>Указания · {o.customer.directions}</p>}
          {o.customer.note && <p>Бележка · {o.customer.note}</p>}
        </Panel>
        <Panel title="Стойност">
          <OrderTotal o={o} />
        </Panel>
      </section>
      <Panel title="Списък за събиране">
        <div className="adm-tablewrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Продукт</th>
                <th>Заявено</th>
                <th>Подготвено</th>
                <th>Цена / крайна сума</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.snapshot.productName}</strong>
                    <br />
                    {i.snapshot.variantName} · {i.snapshot.pack}
                    <br />
                    <small>
                      {i.snapshot.category || i.snapshot.categoryName}{" "}
                      {i.snapshot.terms}
                    </small>
                    <br />
                    <small>
                      {i.substitution === "call"
                        ? "Обаждане за замяна"
                        : "Пропусни при липса"}
                      {i.note ? " · " + i.note : ""}
                    </small>
                    {i.change_detail.proposal && (
                      <p>Предложение · {i.change_detail.proposal.name}</p>
                    )}
                    {i.status === "replaced" && (
                      <p>
                        Замяна · {i.change_detail.prepared?.productName} ·{" "}
                        {i.change_detail.prepared?.variantName}
                      </p>
                    )}
                  </td>
                  <td>
                    {Number(i.quantity)}{" "}
                    {i.snapshot.unit === "kg" ? "кг" : "бр."}
                  </td>
                  <td>
                    {i.prepared_quantity == null
                      ? "—"
                      : Number(i.prepared_quantity)}
                    <br />
                    {label(i.status)}
                  </td>
                  <td>
                    {money(i.unit_cents)} / {money(i.line_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editing &&
          items.map((i) => (
            <ItemEditor key={i.id} order={o} item={i} variants={variants} />
          ))}
      </Panel>
      {open && (
        <div className="no-print">
          <Panel title="Обработка">
            <div className="adm-grid">
              {o.status === "new" && (
                <OrderAction
                  id={id}
                  action="confirm"
                  title="Потвърди поръчката"
                />
              )}
              {o.status === "confirmed" && (
                <OrderAction
                  id={id}
                  action="prepare"
                  title="Започни подготовка"
                />
              )}
              {o.status === "preparing" && (
                <OrderAction
                  id={id}
                  action="ready"
                  title="Готова за доставка"
                />
              )}
              {o.status === "ready" && (
                <OrderAction
                  id={id}
                  action="dispatch"
                  title="Предай на доставчика"
                />
              )}
              {["waiting", "problem"].includes(o.status) && (
                <OrderAction
                  id={id}
                  action="resume"
                  title="Продължи обработката"
                />
              )}
            </div>
            <DeliveryActions o={o} age={age} />
            {["confirmed", "preparing"].includes(o.status) && (
              <OrderAction
                id={id}
                action="wait"
                title="Чака решение от клиента"
              >
                <Field title="Причина за изчакване">
                  <input name="reason" required />
                </Field>
              </OrderAction>
            )}
            <details className="adm-details">
              <summary>Доставчик, интервал и отказ</summary>
              <OrderAction id={id} action="assign" title="Възложи на доставчик">
                <Field title="Доставчик">
                  <select
                    name="courier"
                    defaultValue={o.assigned_to || ""}
                    required
                  >
                    <option value="">Избери</option>
                    {couriers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </OrderAction>
              {!["on_route", "problem"].includes(o.status) && (
                <OrderAction id={id} action="move" title="Премести в интервала">
                  <Field title="Свободен интервал за същия район">
                    <select name="slot" defaultValue="" required>
                      <option value="">Избери</option>
                      {slots.slots.map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.day} · {s.start_time.slice(0, 5)}–
                          {s.end_time.slice(0, 5)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </OrderAction>
              )}
              <OrderAction
                id={id}
                action="cancel"
                title="Откажи поръчката"
                confirm="Отказ на поръчката и освобождаване на мястото?"
              >
                <Field title="Причина за отказ">
                  <input name="reason" required />
                </Field>
              </OrderAction>
            </details>
          </Panel>
        </div>
      )}
      <Panel title="Плащания">
        <p>Общо получено · {money(balance)}</p>
        {payments.map((p) => (
          <p key={p.id}>
            {dateTime(p.created_at)} · {p.actor_name} · {money(p.amount_cents)}{" "}
            · {label(p.method)} {p.reason}
          </p>
        ))}
        {["on_route", "delivered", "problem"].includes(o.status) &&
          balance < o.total_cents && <MoneyAction o={o} balance={balance} />}
        {balance > 0 && (
          <details className="adm-details no-print">
            <summary>Корекция или възстановяване</summary>
            <MoneyAction o={o} balance={balance} refund />
          </details>
        )}
      </Panel>
      <Panel title="Откази и рекламации">
        {claims.map((c) => (
          <div key={c.id}>
            <p>
              <strong>
                {c.kind === "withdraw" ? "Законов отказ" : "Рекламация"}
              </strong>{" "}
              · {dateTime(c.created_at)} · {label(c.status)}
            </p>
            <p>
              {c.reason} {c.contact?.email}
            </p>
            <ul>
              {c.item_details.map((line: ClaimLine) => (
                <li key={line.id}>{lineName(line)}</li>
              ))}
            </ul>
            <OrderAction id={id} action="resolveClaim" title="Запиши решение">
              <input name="claim" type="hidden" value={c.id} />
              <div className="adm-grid">
                <Field title="Решение">
                  <select name="claimStatus">
                    <option value="accepted">Приета</option>
                    <option value="rejected">Отхвърлена</option>
                    <option value="resolved">Приключена</option>
                  </select>
                </Field>
                <Field title="Основание">
                  <input name="reason" required />
                </Field>
              </div>
            </OrderAction>
          </div>
        ))}
        <details className="adm-details no-print">
          <summary>Регистрирай рекламация</summary>
          <CommandForm command="claim.create">
            <input name="id" type="hidden" value={id} />
            <div className="adm-fields">
              {items.map((i) => (
                <label className="adm-check" key={i.id}>
                  <input type="checkbox" name="items[]" value={i.id} />
                  {lineName(claimLine(i))}
                </label>
              ))}
              <Channel />
              <Field title="Причина">
                <textarea name="reason" required />
              </Field>
              <Submit>Запиши рекламацията</Submit>
            </div>
          </CommandForm>
        </details>
      </Panel>
      <Panel title="Хронология">
        <ol>
          {events.map((e) => (
            <li key={e.id}>
              {dateTime(e.created_at)} · {label(e.kind)} ·{" "}
              {e.actor_name || "Клиент / система"} {e.detail.reason}{" "}
              {e.detail.approval &&
                " · Съгласие от " +
                  e.detail.approval.by +
                  " (" +
                  label(e.detail.approval.channel) +
                  ")"}
            </li>
          ))}
        </ol>
      </Panel>
      <section className="adm-print-only" style={{ display: "none" }}>
        <h2>Потвърждение на поръчката</h2>
        <p>Общи условия · версия {o.terms_version}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{o.terms_snapshot?.body}</p>
      </section>
    </>
  );
}
