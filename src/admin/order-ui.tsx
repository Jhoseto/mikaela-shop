import type { ReactNode } from "react";
import { Field, CommandForm, Submit } from "./widgets";
import { money } from "./format";
type Row = Record<string, any>;
export function OrderAction({
  id,
  action,
  title,
  children,
  confirm,
}: {
  id: string;
  action: string;
  title: string;
  children?: ReactNode;
  confirm?: string;
}) {
  return (
    <CommandForm command={"order." + action} confirm={confirm}>
      <input name="id" type="hidden" value={id} />
      {children}
      <div className="adm-actions">
        <Submit secondary>{title}</Submit>
      </div>
    </CommandForm>
  );
}
export function Channel() {
  return (
    <Field title="Канал за контакт">
      <select name="channel">
        <option value="phone">Телефон</option>
        <option value="sms">SMS</option>
        <option value="email">Имейл</option>
        <option value="in_person">На място</option>
      </select>
    </Field>
  );
}
export function ItemEditor({
  order,
  item,
  variants,
}: {
  order: Row;
  item: Row;
  variants: Row[];
}) {
  const alternatives = variants.filter((v) => v.id !== item.variant_id);
  const variantsInput = (
    <Field title="Заместващ продукт и разновидност">
      <select name="variant">
        <option value="">Избери при замяна</option>
        {alternatives.map((v) => (
          <option value={v.id} key={v.id}>
            {v.product} · {v.name} · {v.pack}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <details className="adm-details no-print">
      <summary>{item.snapshot.productName} · обработване</summary>
      <OrderAction id={order.id} action="item" title="Запази обработката">
        <input type="hidden" name="item" value={item.id} />
        <div className="adm-grid">
          <Field title="Подготвен артикул">
            <select
              name="itemStatus"
              defaultValue={
                item.status === "requested" ? "prepared" : item.status
              }
            >
              <option value="prepared">Подготвен</option>
              <option value="missing">Липсва</option>
              {item.substitution === "call" && <option value="replaced">Одобрена замяна</option>}
            </select>
          </Field>
          <Field title="Действително количество">
            <input
              name="quantity"
              inputMode="decimal"
              defaultValue={item.prepared_quantity ?? item.quantity}
            />
          </Field>
          {variantsInput}
          <Field title="Причина / уточнение">
            <input name="reason" maxLength={1000} />
          </Field>
        </div>
        <details className="adm-details">
          <summary>Съгласуване с клиента</summary>
          <label className="adm-check">
            <input type="checkbox" name="consent" />
            Клиентът потвърди това решение
          </label>
          <div className="adm-grid">
            <Field title="Кой потвърди">
              <input name="approvalBy" />
            </Field>
            <Channel />
          </div>
        </details>
      </OrderAction>
      {item.substitution === "call" && (
        <>
          <OrderAction
            id={order.id}
            action="propose"
            title="Запиши предложение за замяна"
          >
            <input type="hidden" name="item" value={item.id} />
            <div className="adm-grid">
              {variantsInput}
              <Field title="Предложение до клиента">
                <input name="reason" required />
              </Field>
            </div>
          </OrderAction>
          <OrderAction
            id={order.id}
            action="contact"
            title="Запиши опит за връзка"
          >
            <input type="hidden" name="item" value={item.id} />
            <div className="adm-grid">
              <Channel />
              <Field title="Резултат от връзката">
                <input name="reason" required />
              </Field>
            </div>
          </OrderAction>
        </>
      )}
    </details>
  );
}
export function MoneyAction({
  o,
  refund = false,
  balance = 0,
}: {
  o: Row;
  refund?: boolean;
  balance?: number;
}) {
  const amount = refund ? balance : o.total_cents - balance;
  return (
    <OrderAction
      id={o.id}
      action={refund ? "refund" : "payment"}
      title={refund ? "Отчети възстановяване" : "Отчети получената сума"}
    >
      <div className="adm-grid">
        <Field
          title={
            refund
              ? "Сума за възстановяване (€)"
              : "Действително получена сума (€)"
          }
        >
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={Math.max(0, amount / 100).toFixed(2)}
            required
          />
        </Field>
        <Field title="Начин на плащане">
          <select name="method" defaultValue={o.payment_method}>
            <option value="cash">В брой</option>
            <option value="card">С карта при доставка</option>
          </select>
        </Field>
        {refund && (
          <Field title="Причина">
            <input name="reason" required />
          </Field>
        )}
      </div>
    </OrderAction>
  );
}
export function DeliveryActions({ o, age }: { o: Row; age: boolean }) {
  return (
    <>
      {["on_route", "problem"].includes(o.status) && (
        <OrderAction id={o.id} action="deliver" title="Доставена">
          {age && (
            <label className="adm-check">
              <input type="checkbox" name="ageChecked" required />
              Възрастта е проверена при предаване
            </label>
          )}
        </OrderAction>
      )}
      {o.status === "on_route" && (
        <OrderAction id={o.id} action="problem" title="Проблем с доставката">
          <Field title="Какво се случи">
            <input name="reason" required />
          </Field>
        </OrderAction>
      )}
    </>
  );
}
export function address(o: Row) {
  const c = o.customer;
  return [
    o.delivery_snapshot.name,
    c.street,
    c.entrance && "вх. " + c.entrance,
    c.floor && "ет. " + c.floor,
    c.apartment && "ап. " + c.apartment,
  ]
    .filter(Boolean)
    .join(", ");
}
export function interval(o: Row) {
  const s = o.delivery_snapshot;
  return [
    s.day,
    s.start_time?.slice(0, 5) + "–" + s.end_time?.slice(0, 5),
  ].join(" · ");
}
export function OrderTotal({ o }: { o: Row }) {
  return (
    <dl className="adm-dl">
      <dt>Първоначално</dt>
      <dd>{money(o.original_cents)}</dd>
      <dt>Продукти</dt>
      <dd>{money(o.subtotal_cents)}</dd>
      <dt>Доставка</dt>
      <dd>{money(o.delivery_cents)}</dd>
      {o.extra_cents > 0 && (
        <>
          <dt>Допълнителни такси</dt>
          <dd>{money(o.extra_cents)}</dd>
        </>
      )}
      <dt>Крайна сума</dt>
      <dd>
        <strong>{money(o.total_cents)}</strong>
      </dd>
    </dl>
  );
}
