"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Printer, ReceiptText } from "lucide-react";
import { money, shortDate, amount } from "./model";
import { claimLine, lineName } from "@/commerce/order-line";

const states: Record<string, string> = {
  new: "Получена",
  confirmed: "Потвърдена",
  preparing: "Подготвя се",
  ready: "Готова",
  out_for_delivery: "На път",
  en_route: "На път",
  on_route: "На път",
  delivered: "Доставена",
  awaiting_customer: "Чака решение от клиента",
  waiting: "Чака решение от клиента",
  cancelled: "Отказана",
  canceled: "Отказана",
  delivery_issue: "Проблем при доставка",
  problem: "Проблем при доставка",
  paid: "Платена",
  pending: "Очаква плащане",
  refunded: "Възстановена сума",
  partial: "Частично плащане",
  adjusted: "Корекция",
  received: "Получена",
  approved: "Одобрена",
  rejected: "Отхвърлена",
  closed: "Приключена",
  open: "Отворена",
  submitted: "Подадена",
  resolved: "Решена",
  review: "В преглед",
  created: "Получаване на поръчката",
  status: "Промяна на статуса",
  status_changed: "Промяна на статуса",
  payment: "Отчетено плащане",
  claim: "Рекламация",
  withdraw: "Отказ от договор",
  withdrawal: "Отказ от договор",
  requested: "Заявено",
  missing: "Липсва",
  prepared: "Подготвено",
  substituted: "Заменено",
  replaced: "Заменено",
  accepted: "Прието",
  item: "Обновена подготовка на артикул",
  contact: "Опит за връзка",
  assign: "Възложена доставка",
  move: "Преместен интервал",
  refund: "Възстановена сума",
  skipped: "Пропуснато",
};
const label = (v: unknown, fallback: string) => states[String(v)] || fallback;
const datetime = (v: string) =>
  new Intl.DateTimeFormat("bg-BG", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Sofia",
  }).format(new Date(v));
type TrackingData = {
  order: Record<string, any>;
  items: Record<string, any>[];
  events: Record<string, any>[];
  claims: Record<string, any>[];
};
export function FindOrder() {
  const router = useRouter(),
    [value, setValue] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      className="find-order"
      onSubmit={(e) => {
        e.preventDefault();
        let token = value.trim();
        try {
          if (token.includes("/")) {
            const url = new URL(token, window.location.origin);
            const match = url.pathname.match(/^\/prosledyavane\/([^/]+)\/?$/);
            if (!match) throw new Error();
            token = decodeURIComponent(match[1]);
          }
          if (!/^[A-Za-z0-9_-]{20,180}$/.test(token)) throw new Error();
          router.push("/prosledyavane/" + encodeURIComponent(token) + "#otkaz");
        } catch {
          setError(
            "Въведи връзката или кода от потвърждението на поръчката.",
          );
        }
      }}
    >
      <label className="field">
        Връзка или код за проследяване
        <input
          value={value}
          required
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          maxLength={500}
        />
      </label>
      {error && (
        <p className="shop-error" role="alert">
          {error}
        </p>
      )}
      <button className="shop-button">
        Отвори поръчката <ArrowRight size={16} />
      </button>
    </form>
  );
}
export function Tracking({ token }: { token: string }) {
  const [data, setData] = useState<TrackingData | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [action, setAction] = useState<"cancel" | "withdraw" | "claim" | null>(
      null,
    ),
    [review, setReview] = useState(false),
    [ids, setIds] = useState<string[]>([]);
  const [contact, setContact] = useState({ name: "", email: "", reason: "" });
  const endpoint = "/api/tracking/" + encodeURIComponent(token);
  const refresh = useCallback(async () => {
    const r = await fetch(endpoint, { cache: "no-store" });
    const o = await r.json();
    if (!r.ok)
      throw new Error(o.error || "Връзката за проследяване е невалидна.");
    setData(o);
    setError("");
  }, [endpoint]);
  useEffect(() => {
    let active = true;
    const poll = () => {
      if (document.visibilityState === "visible")
        refresh().catch((e) => {
          if (active) setError(e instanceof TypeError || e instanceof SyntaxError
            ? "Не успяхме да заредим поръчката. Опитай отново."
            : e.message);
        });
    };
    poll();
    const t = window.setInterval(poll, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [refresh]);
  const choose = (type: typeof action) => {
    setAction(type);
    setReview(false);
    setIds([]);
    setMessage("");
    setError("");
    setContact({ name: "", email: "", reason: "" });
  };
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!action || busy) return;
    if (action !== "cancel" && !ids.length) {
      setError("Избери поне един артикул.");
      return;
    }
    if (!review) {
      setReview(true);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          itemIds: ids,
          ...contact,
          confirm: true,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Заявката не бе приета.");
      setAction(null);
      setReview(false);
      setMessage(
        action === "cancel"
          ? "Поръчката е отменена."
          : action === "withdraw"
            ? "Получихме заявлението за отказ."
            : "Получихме рекламацията.",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError || e instanceof SyntaxError)
        ? e.message : "Не успяхме да потвърдим промяната. Провери поръчката си.");
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <div className="shop-width inner-page">
        <h1>Проследяване на поръчка</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Зареждане на поръчката…"}
        </p>
        <Link className="text-link" href="/informacia/kontakti">
          Връзка с магазина
        </Link>
      </div>
    );
  const o = data.order,
    d = o.delivery_snapshot || {};
  const deliveredItems=data.items.filter(item=>item.status!=="missing");
  const withdrawalItems=deliveredItems.filter(item=>(item.prepared?.food||item.snapshot?.food)?.withdrawal!=="perishable");
  return (
    <div className="shop-width inner-page tracking">
      <div className="confirm-heading">
        <span>
          <Check size={27} />
        </span>
        <div>
          <p className="eyebrow">Поръчка № {o.number}</p>
          <h1>
            {o.status === "new" ? "Поръчката е получена" : "Твоята поръчка"}
          </h1>
          {o.test_only ? <p>Пробна поръчка без доставка и плащане.</p>
            : o.status === "new" && <p>Очаква потвърждение от магазина.</p>}
        </div>
      </div>
      {o.status === "new" && <p className="fine">Запази връзката за проследяване на поръчката.</p>}
      <div className="checkout-grid">
        <div className="checkout-sections">
          <section className="surface">
            <h2>Артикули</h2>
            <div className="receipt-lines">
              {data.items.map((i) => {
                const s = i.snapshot || {};
                return (
                  <div key={i.id}>
                    <span>
                      {s.productName || s.name || i.product_name || "Артикул"}
                      <small>
                        {[s.variantName, s.pack].filter(Boolean).join(" · ")} ·{" "}
                        {amount(Number(i.quantity))}{" "}
                        {s.unit === "kg" ? "кг" : "бр."}
                        {i.prepared_quantity != null &&
                          " · Подготвено " +
                            amount(Number(i.prepared_quantity))}
                        {i.status &&
                          i.status !== "requested" &&
                          " · " + label(i.status, "Обработено")}
                        {i.status === "replaced" &&
                          i.prepared &&
                          " · " +
                            [
                              i.prepared.productName,
                              i.prepared.variantName,
                              i.prepared.pack,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                      </small>
                    </span>
                    <b>{money(i.line_cents || 0)}</b>
                  </div>
                );
              })}
            </div>
            <dl className="totals">
              <div>
                <dt>Доставка</dt>
                <dd>{money(o.delivery_cents || 0)}</dd>
              </div>
              {!!o.extra_cents && (
                <div>
                  <dt>Допълнителни такси</dt>
                  <dd>{money(o.extra_cents)}</dd>
                </div>
              )}
              {o.original_cents !== o.total_cents && <div>
                <dt>Първоначална сума</dt>
                <dd>{money(o.original_cents || 0)}</dd>
              </div>}
              <div className="total-line">
                <dt>Общо</dt>
                <dd>{money(o.total_cents || 0)}</dd>
              </div>
            </dl>
          </section>
          <section className="surface">
            <h2>История</h2>
            <ol className="timeline">
              {data.events.map((ev, i) => (
                <li key={ev.id || i}>
                  <b>
                    {label(
                      ev.detail?.status || ev.detail?.to || ev.kind,
                      "Обновяване на поръчката",
                    )}
                  </b>
                  <time>{ev.created_at && datetime(ev.created_at)}</time>
                </li>
              ))}
            </ol>
            {!!data.claims.length && (
              <>
                <h3>Заявления и рекламации</h3>
                {data.claims.map((c, i) => (
                  <p key={c.id || i}>
                    {label(c.kind, "Заявление")} · {label(c.status, "Получена")}{" "}
                    {c.created_at && datetime(c.created_at)}
                    {c.item_details?.length > 0 && " · " + c.item_details.map(lineName).join(", ")}
                  </p>
                ))}
              </>
            )}
          </section>
        </div>
        <aside className="surface order-summary">
          <h2>
            <ReceiptText size={20} /> Поръчка № {o.number}
          </h2>
          <dl className="totals">
            <div>
              <dt>Статус</dt>
              <dd>{label(o.status, "Обработва се")}</dd>
            </div>
            {!o.test_only && (
              <>
                <div>
                  <dt>Плащане</dt>
                  <dd>{label(o.payment_status, "Очаква плащане")}</dd>
                </div>
                <div>
                  <dt>Начин на плащане</dt>
                  <dd>{o.payment_method === "card" ? "С карта при доставка" : "В брой при доставка"}</dd>
                </div>
              </>
            )}
            {(d.day || d.date) && (
              <div>
                <dt>{o.test_only ? "Избран интервал" : "Доставка"}</dt>
                <dd>
                  {shortDate(d.day || d.date, true)}
                  <br />
                  {String(d.start_time || d.start || "").slice(0, 5)}–
                  {String(d.end_time || d.end || "").slice(0, 5)}
                </dd>
              </div>
            )}
          </dl>
          <button className="shop-outline" onClick={() => window.print()}>
            <Printer size={16} /> Отпечатай
          </button>
        </aside>
      </div>
      <section className="surface guest-actions" id="otkaz">
        <h2>Отказ и рекламации</h2>
        <div className="button-row">
          {["new", "confirmed"].includes(o.status) && (
            <button className="shop-outline" onClick={() => choose("cancel")}>
              Отмени преди подготовка
            </button>
          )}
          {o.status === "delivered" && withdrawalItems.length>0 && (
            <button className="shop-outline" onClick={() => choose("withdraw")}>
              Откажете се от договора тук
            </button>
          )}
          {o.status === "delivered" && (
            <button className="shop-outline" onClick={() => choose("claim")}>
              Подай рекламация
            </button>
          )}
          <Link className="text-link" href="/informacia/otkaz-i-reklamacii">
            Условия за отказ и рекламации
          </Link>
        </div>
        {error && (
          <p className="shop-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="shop-notice" role="status">
            {message}
          </p>
        )}
        {action && (
          <form className="guest-form" onSubmit={send}>
            <h3>
              {action === "cancel"
                ? "Отмяна на поръчката"
                : action === "withdraw"
                  ? "Заявление за отказ от договора"
                  : "Рекламация"}
            </h3>
            {action !== "cancel" && (
              <fieldset disabled={review}>
                <legend>Артикули</legend>
                {(action==="withdraw"?withdrawalItems:deliveredItems).map((i) => (
                  <label key={i.id} className="check">
                    <input
                      type="checkbox"
                      checked={ids.includes(i.id)}
                      onChange={(e) =>
                        setIds((previous) =>
                          e.target.checked
                            ? [...previous, i.id]
                            : previous.filter((v) => v !== i.id),
                        )
                      }
                    />
                    {lineName(claimLine(i))}
                  </label>
                ))}
              </fieldset>
            )}
            {action !== "cancel" && (
              <div className="form-grid">
                <label className="field">
                  Име {action==="claim"&&<small>(по желание)</small>}
                  <input
                    required={action==="withdraw"}
                    maxLength={120}
                    readOnly={review}
                    value={contact.name}
                    onChange={(e) =>
                      setContact({ ...contact, name: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Имейл за потвърждението {action==="claim"&&<small>(по желание)</small>}
                  <input
                    type="email"
                    required={action==="withdraw"}
                    maxLength={250}
                    readOnly={review}
                    value={contact.email}
                    onChange={(e) =>
                      setContact({ ...contact, email: e.target.value })
                    }
                  />
                </label>
              </div>
            )}
            <label className="field">
              {action === "claim"
                ? "Описание на рекламацията"
                : action === "cancel"
                  ? "Причина за отмяната (по желание)"
                  : "Бележка (по желание)"}
              <textarea
                required={action === "claim"}
                maxLength={1200}
                readOnly={review}
                value={contact.reason}
                onChange={(e) =>
                  setContact({ ...contact, reason: e.target.value })
                }
              />
            </label>
            <div className="button-row">
              {review && (
                <button
                  type="button"
                  className="shop-outline"
                  onClick={() => setReview(false)}
                >
                  Редактирай
                </button>
              )}
              <button disabled={busy} className="shop-button">
                {busy
                  ? "Изпращане…"
                  : !review
                    ? "Преглед на заявлението"
                    : action === "withdraw"
                      ? "Потвърждавам отказа"
                      : action === "claim"
                        ? "Подай рекламацията"
                        : "Потвърди отмяната"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
