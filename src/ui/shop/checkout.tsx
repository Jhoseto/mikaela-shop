"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  MapPin,
  ShoppingBasket,
  Trash2,
} from "lucide-react";
import { useBasket } from "./basket";
import { parseZones } from "./shell";
import { Quantity } from "./quantity";
import { ProductImage } from "./media";
import {
  amount,
  basketVariantLabel,
  money,
  productHref,
  shortDate,
  type BasketLine,
  type ShopSettings,
  type ShopZone,
} from "./model";
type DeliveryRow = {
  id: string;
  day: string;
  start_time: string;
  end_time: string;
  capacity?: number;
  reserved?: number;
};
type Quote = {
  testOnly?: boolean;
  items: {
    variantId: string;
    productName: string;
    variantName: string;
    pack: string;
    unit: string;
    quantity: number;
    unitCents: number;
    lineCents: number;
    terms: string;
    offer?: { terms?: string; ends: string } | null;
  }[];
  subtotal: number;
  delivery: number;
  extra: number;
  total: number;
  signature: string;
  termsVersion: number;
};
const pendingKey = "mikaela.checkout.pending.v1";
function VariantChoice({ line, onChange }: { line: BasketLine; onChange: (value: string) => void }) {
  return (
    <label className="field mt-3">
      Желан вариант за {line.title}
      <input
        required
        maxLength={120}
        value={line.requestedVariant ?? ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Вкус, вид или разфасовка"
      />
    </label>
  );
}
function EmptyCart() {
  return (
    <div className="empty-state">
      <ShoppingBasket />
      <h2>Количката е празна</h2>
      <Link href="/produkti" className="shop-button">
        Разгледай продуктите <ArrowRight size={17} />
      </Link>
    </div>
  );
}
function QuoteTotals({
  quote,
  estimateTotal,
}: {
  quote: Quote | null;
  estimateTotal: number;
}) {
  return (
    <dl className="totals">
      <div>
        <dt>Продукти</dt>
        <dd>{money(quote?.subtotal ?? estimateTotal)}</dd>
      </div>
      <div>
        <dt>Доставка</dt>
        <dd>{quote ? money(quote.delivery) : "Избери интервал"}</dd>
      </div>
      {!!quote?.extra && (
        <div>
          <dt>Допълнителни такси</dt>
          <dd>{money(quote.extra)}</dd>
        </div>
      )}
      <div className="total-line">
        <dt>{quote ? "Общо" : "Общо без доставка"}</dt>
        <dd>{money(quote?.total ?? estimateTotal)}</dd>
      </div>
    </dl>
  );
}
export function OrderFlow({
  settings,
  checkout = false,
}: {
  settings: ShopSettings;
  checkout?: boolean;
}) {
  const cart = useBasket(),
    router = useRouter();
  const [zones, setZones] = useState<ShopZone[]>([]),
    [slots, setSlots] = useState<DeliveryRow[]>([]),
    [slot, setSlot] = useState(""),
    [payment, setPayment] = useState("cash");
  const [quote, setQuote] = useState<Quote | null>(null),
    [loading, setLoading] = useState(false),
    [deliveryBusy, setDeliveryBusy] = useState(true);
  const [error, setError] = useState(""),
    [deliveryError, setDeliveryError] = useState(""),
    [deliveryRetry, setDeliveryRetry] = useState(0);
  const [message, setMessage] = useState(""),
    [submitting, setSubmitting] = useState(false),
    [pending, setPending] = useState(false),
    [consentWeight, setConsentWeight] = useState(false),
    [terms, setTerms] = useState(false);
  const savedRequest = useRef<Record<string, unknown> | null>(null),
    inFlight = useRef(false);
  const bodyItems = cart.lines.map((l) => ({
    variantId: l.variantId,
    quantity: l.quantity,
    note: l.note,
    substitution: l.substitution,
    ...(l.requiresVariantChoice && { requestedVariant: l.requestedVariant?.trim() || "" }),
    weightTolerance:
      l.unit === "kg" && consentWeight
        ? settings.weightTolerancePercent || 0
        : 0,
  }));
  const hasUnspecifiedVariant = cart.lines.some((line) => line.requiresVariantChoice && !line.requestedVariant?.trim());
  const localOffers = settings.promoBasis === "order"
    ? []
    : cart.lines.filter((line) => line.localBrochureOrder && line.offer).map((line) => line.offer!);
  const firstDay = localOffers.map((offer) => offer.starts || "").sort().at(-1) || "";
  const lastDay = localOffers.map((offer) => offer.ends).sort()[0] || "";
  const calculation = JSON.stringify({
    zoneId: cart.zone,
    slotId: slot,
    items: bodyItems,
    payment,
  });
  useEffect(() => {
    if (!checkout) return;
    try {
      const raw = sessionStorage.getItem(pendingKey);
      if (raw) {
        savedRequest.current = JSON.parse(raw);
        setPending(true);
      }
    } catch {}
  }, [checkout]);
  useEffect(() => {
    const ac = new AbortController();
    setDeliveryBusy(true);
    setDeliveryError("");
    setSlots([]);
    setSlot("");
    fetch(
      "/api/delivery" +
        (cart.zone ? "?zone=" + encodeURIComponent(cart.zone) : ""),
      { cache: "no-store", signal: ac.signal },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => {
        const activeZones = parseZones(d.zones);
        setZones(activeZones);
        if (settings.localBrochureOrdering && activeZones.length === 1 && cart.zone !== activeZones[0].id) {
          cart.setZone(activeZones[0].id);
        }
        const list: DeliveryRow[] = Array.isArray(d.slots)
          ? d.slots.filter(
              (s: DeliveryRow) =>
                (!firstDay || s.day >= firstDay) && (!lastDay || s.day <= lastDay) &&
                (s.capacity == null || s.reserved == null || s.reserved < s.capacity),
            )
          : [];
        setSlots(list);
        try {
          const old = sessionStorage.getItem("mikaela.slot." + cart.zone);
          if (old && list.some((s) => s.id === old)) setSlot(old);
        } catch {}
      })
      .catch(() => {
        if (!ac.signal.aborted)
          setDeliveryError("Районите и часовете не се заредиха.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setDeliveryBusy(false);
      });
    return () => ac.abort();
  }, [cart.zone, deliveryRetry, firstDay, lastDay, settings.localBrochureOrdering]);
  useEffect(() => {
    setQuote(null);
    setTerms(false);
    setError("");
    setMessage("");
    if (!cart.zone || !slot || !bodyItems.length || hasUnspecifiedVariant) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: calculation,
      signal: ac.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Общата сума не може да се изчисли. Опитай отново.");
        return d;
      })
      .then((q) => setQuote(q))
      .catch((e) => {
        if (!ac.signal.aborted) setError(e instanceof TypeError || e instanceof SyntaxError
          ? "Не успяхме да заредим цените. Опитай отново."
          : e.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [calculation, cart.zone, slot, cart.lines.length, hasUnspecifiedVariant]);
  const selectSlot = (value: string) => {
    setSlot(value);
    try {
      sessionStorage.setItem("mikaela.slot." + cart.zone, value);
    } catch {}
  };
  const chosenZone = zones.find((z) => z.id === cart.zone);
  async function place(body: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    setMessage("");
    savedRequest.current = body;
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(body));
    } catch {}
    try {
      const resp = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (resp.status >= 500) throw new Error();
        savedRequest.current = null;
        setPending(false);
        try {
          sessionStorage.removeItem(pendingKey);
        } catch {}
        if (resp.status === 409) {
          setTerms(false);
          if (data.quote) {
            setQuote(data.quote);
            const changedTotal =
              quote && quote.total !== data.quote.total
                ? " Предишна сума " +
                  money(quote.total) +
                  ". Нова сума " +
                  money(data.quote.total) +
                  "."
                : "";
            setMessage(
              "Условията се промениха." +
                changedTotal +
                " Прегледай ги и потвърди отново.",
            );
          } else {
            setDeliveryRetry((x) => x + 1);
            setQuote(null);
          }
        }
        setError(data.error || "Поръчката изисква промяна.");
        return;
      }
      if (!data.token) throw new Error();
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {}
      savedRequest.current = null;
      setPending(false);
      cart.clear();
      router.replace("/prosledyavane/" + encodeURIComponent(data.token));
    } catch {
      setPending(true);
      setError(
        "Връзката прекъсна. Провери дали поръчката е получена.",
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!quote || !terms || submitting || pending || hasUnspecifiedVariant) return;
    const f = new FormData(e.currentTarget),
      customer = Object.fromEntries(
        [
          "name",
          "phone",
          "email",
          "street",
          "entrance",
          "floor",
          "apartment",
          "directions",
          "note",
        ].map((k) => [k, String(f.get(k) || "").trim()]),
      );
    void place({
      ...JSON.parse(calculation),
      customer,
      termsVersion: quote.termsVersion,
      quoteSignature: quote.signature,
      idempotencyKey: crypto.randomUUID(),
    });
  }
  const isEstimated = cart.lines.some((l) => l.unit === "kg");
  const changedRows =
    quote?.items.flatMap((item) => {
      const line = cart.lines.find((l) => l.variantId === item.variantId);
      if (!line) return [];
      const oldPrice = cart.lineTotals[line.variantId];
      const oldOffer = line.offer?.label || "";
      const activeOffer = item.offer
        ? item.offer.terms || (line.localBrochureOrder ? "Цена от брошурата" : "Промоционална цена")
        : "";
      const changes = [];
      if (oldPrice !== item.lineCents)
        changes.push(money(oldPrice) + " → " + money(item.lineCents));
      if (oldOffer !== activeOffer)
        changes.push(activeOffer || "без промоция за избрания ден");
      return changes.length
        ? [item.productName + " — " + changes.join(", ")]
        : [];
    }) || [];
  return (
    <div className="shop-width inner-page">
      <nav className="breadcrumbs">
        <Link href="/">Начало</Link>
        <ChevronRight />
        {checkout ? (
          <>
            <Link href="/kolichka">Количка</Link>
            <ChevronRight />
            Завършване на поръчка
          </>
        ) : (
          "Количка"
        )}
      </nav>
      <div className="page-title">
        <h1>{checkout ? "Завършване на поръчка" : "Твоята количка"}</h1>
        {checkout && (
          <Link href="/kolichka" className="text-link">
            <ArrowLeft size={15} /> Редактирай количката
          </Link>
        )}
      </div>
      {pending && checkout ? (
        <div className="surface">
          <h2>Очаква се потвърждение</h2>
          {error && <p role="alert">{error}</p>}
          <button
            className="shop-button"
            disabled={submitting}
            onClick={() => savedRequest.current && place(savedRequest.current)}
          >
            {submitting ? "Проверява се…" : "Провери поръчката"}
          </button>
        </div>
      ) : !cart.ready ? (
        <p role="status">Зареждане на количката…</p>
      ) : !cart.lines.length ? (
        <EmptyCart />
      ) : (
        <form onSubmit={submit} className="checkout-grid">
          <div className="checkout-sections">
            {!checkout && (
              <section className="surface cart-table">
                <h2>Продукти</h2>
                {cart.lines.map((l) => {
                  const item = quote?.items.find(
                    (i) => i.variantId === l.variantId,
                  );
                  const offer = item
                    ? item.offer
                      ? {
                          label: item.offer.terms || (l.localBrochureOrder ? "Цена от брошурата" : "Промоционална цена"),
                          ends: item.offer.ends,
                        }
                      : null
                    : l.offer;
                  return (
                    <article key={l.variantId} className="basket-row">
                      <div className="basket-row-head">
                        <ProductImage src={l.image} name={l.title} />
                        <div>
                          <Link href={productHref(l.productSlug)}>
                            {l.title}
                          </Link>
                          <small>
                            {basketVariantLabel(l)}
                          </small>
                          <small>
                            {money(item?.unitCents ?? l.price)} /{" "}
                            {l.unit === "kg" ? "кг" : "бр."}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={"Премахни " + l.title}
                          onClick={() => cart.adjust(l.variantId, 0)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                      <div className="basket-quantity">
                        <Quantity
                          id={l.variantId}
                          qty={l.quantity}
                          step={l.step}
                          max={l.max}
                          unit={l.unit}
                          label={l.title}
                        />
                        <b>
                          {money(item?.lineCents ?? cart.lineTotals[l.variantId])}
                          {l.unit === "kg" && " ≈"}
                        </b>
                      </div>
                      {offer && (
                        <p className="offer-condition">
                          {offer.label} · до {shortDate(offer.ends)}
                        </p>
                      )}
                      {l.requiresVariantChoice && (
                        <VariantChoice line={l} onChange={(requestedVariant) => cart.edit(l.variantId, { requestedVariant })} />
                      )}
                      <details>
                        <summary>Предпочитание при липса и бележка</summary>
                        <label className="field">
                          При липса
                          <select
                            aria-label="При липса"
                            value={l.substitution}
                            onChange={(e) =>
                              cart.edit(l.variantId, {
                                substitution: e.target.value as "skip" | "call",
                              })
                            }
                          >
                            <option value="skip">Пропуснете продукта</option>
                            <option value="call">
                              Обадете ми се за замяна
                            </option>
                          </select>
                        </label>
                        <label className="field">
                          Бележка за артикула
                          <input
                            value={l.note}
                            maxLength={400}
                            onChange={(e) =>
                              cart.edit(l.variantId, { note: e.target.value })
                            }
                          />
                        </label>
                      </details>
                    </article>
                  );
                })}
              </section>
            )}
            {checkout && cart.lines.some((line) => line.requiresVariantChoice) && (
              <section className="surface">
                <h2>Варианти на продуктите</h2>
                {cart.lines.filter((line) => line.requiresVariantChoice).map((line) => (
                  <VariantChoice key={line.variantId} line={line} onChange={(requestedVariant) => cart.edit(line.variantId, { requestedVariant })} />
                ))}
              </section>
            )}
            <section className="surface">
              <h2>
                <MapPin size={20} /> Доставка
              </h2>
              <div className="form-grid">
                <label className="field">
                  Населено място или район
                  <select
                    value={cart.zone}
                    required
                    onChange={(e) => cart.setZone(e.target.value)}
                  >
                    <option value="">Избери район</option>
                    {zones.map((z) => (
                      <option value={z.id} key={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Ден и часови интервал
                  <select
                    value={slot}
                    disabled={!cart.zone || deliveryBusy}
                    required
                    onChange={(e) => selectSlot(e.target.value)}
                  >
                    <option value="">
                      {deliveryBusy ? "Зареждане…" : "Избери интервал"}
                    </option>
                    {slots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {shortDate(s.day, true)} · {s.start_time.slice(0, 5)}–
                        {s.end_time.slice(0, 5)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {chosenZone && (
                <p className="fine muted">
                  {chosenZone.minimum > 0 && "Минимална поръчка " + money(chosenZone.minimum) + ". "}
                  {chosenZone.fee ? "Доставка " + money(chosenZone.fee) + "." : "Безплатна доставка."}
                  {chosenZone.fee > 0 && chosenZone.freeFrom != null &&
                    " Безплатна от " + money(chosenZone.freeFrom) + "."}
                </p>
              )}
              {deliveryError && (
                <p role="alert">
                  {deliveryError}{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setDeliveryRetry((x) => x + 1)}
                  >
                    Опитай отново
                  </button>
                </p>
              )}
              {!deliveryBusy &&
                !deliveryError &&
                cart.zone &&
                !slots.length && (
                  <p className="shop-notice">
                    За избрания район в момента няма свободен интервал.
                  </p>
                )}
              {!deliveryBusy && !zones.length && !deliveryError && (
                <p className="shop-notice">
                  В момента няма обслужвани райони.
                </p>
              )}
              {cart.lines.some((line) => line.offer) && settings.promoBasis !== "order" && (
                <p className="fine">Промоционалните цени важат за избрания ден на доставка.</p>
              )}
            </section>
            {checkout && (
              <>
                <section className="surface">
                  <h2>Данни за получателя</h2>
                  <div className="form-grid">
                    <label className="field">
                      Име
                      <input
                        autoComplete="name"
                        required
                        minLength={2}
                        maxLength={120}
                        name="name"
                      />
                    </label>
                    <label className="field">
                      Телефон
                      <input
                        autoComplete="tel"
                        type="tel"
                        required
                        name="phone"
                        minLength={7}
                        maxLength={22}
                      />
                    </label>
                    <label className="field span-all">
                      Улица и номер
                      <input
                        autoComplete="street-address"
                        required
                        minLength={3}
                        name="street"
                        maxLength={250}
                      />
                    </label>
                    {["Вход", "Етаж", "Апартамент"].map((f, i) => (
                      <label className="field" key={f}>
                        {f} <small>(по желание)</small>
                        <input
                          name={["entrance", "floor", "apartment"][i]}
                          maxLength={30}
                        />
                      </label>
                    ))}
                    <label className="field">
                      Имейл <small>(по желание)</small>
                      <input
                        type="email"
                        autoComplete="email"
                        name="email"
                        maxLength={250}
                      />
                    </label>
                    <label className="field span-all">
                      Указания за адреса <small>(по желание)</small>
                      <input name="directions" maxLength={400} />
                    </label>
                    <label className="field span-all">
                      Бележка <small>(по желание)</small>
                      <textarea name="note" maxLength={700} rows={2} />
                    </label>
                  </div>
                  {!settings.localBrochureOrdering && (
                    <p className="fine">Ще получиш потвърждение по имейл или на хартия при доставката.</p>
                  )}
                </section>
                <section className="surface">
                  <h2>Начин на плащане</h2>
                  <label className="check">
                    <input
                      type="radio"
                      name="payment"
                      checked={payment === "cash"}
                      onChange={() => setPayment("cash")}
                    />{" "}
                    В брой при доставка
                  </label>
                  {settings.card && (
                    <label className="check">
                      <input
                        type="radio"
                        name="payment"
                        checked={payment === "card"}
                        onChange={() => setPayment("card")}
                      />{" "}
                      С карта при доставка
                    </label>
                  )}
                  {isEstimated && !!settings.weightTolerancePercent && (
                    <label className="check weight-consent">
                      <input
                        type="checkbox"
                        checked={consentWeight}
                        onChange={(e) => setConsentWeight(e.target.checked)}
                      />{" "}
                      Съгласен съм с увеличение на теглото до{" "}
                      {settings.weightTolerancePercent}% за тегловите продукти.
                    </label>
                  )}
                </section>
              </>
            )}
          </div>
          <aside className="surface order-summary">
            <h2>Обобщение</h2>
            {checkout && (
              <div className="receipt-lines">
                {cart.lines.map((l) => {
                  const i = quote?.items.find(
                    (v) => v.variantId === l.variantId,
                  );
                  return (
                    <div key={l.variantId}>
                      <span>
                        {l.title}
                        <small>
                          {basketVariantLabel(l)}{" "}
                          · {amount(l.quantity)}{" "}
                          {l.unit === "kg" ? "кг" : "бр."}
                          {i?.terms && " · " + i.terms}
                        </small>
                      </span>
                      <b>{money(i?.lineCents ?? cart.lineTotals[l.variantId])}</b>
                    </div>
                  );
                })}
              </div>
            )}
            <QuoteTotals quote={quote} estimateTotal={cart.total} />
            {hasUnspecifiedVariant && (
              <p className="shop-notice">Посочи желаните варианти, за да продължиш.</p>
            )}
            {checkout && settings.localBrochureOrdering && (
              <p className="shop-notice">
                Пробна поръчка без доставка и плащане.
              </p>
            )}
            {!!changedRows.length && (
              <div className="shop-notice" role="status">
                <b>Промени за избрания ден</b>
                <ul className="my-1 list-disc pl-5">
                  {changedRows.map((row) => (
                    <li key={row}>{row}</li>
                  ))}
                </ul>
              </div>
            )}
            {isEstimated && (
              <p className="fine">
                Крайната сума за продуктите на килограм зависи от теглото.
              </p>
            )}
            {loading && <p role="status">Проверяваме цените и интервала…</p>}
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
            {!settings.enabled && (
              <p className="shop-notice">
                Магазинът временно не приема нови поръчки.
              </p>
            )}
            {checkout ? (
              <>
                <label className="check terms-check">
                  <input
                    type="checkbox"
                    required
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                  />
                  <span>
                    Прегледах сумите и приемам{" "}
                    <Link target="_blank" href="/informacia/obshti-usloviya">
                      общите условия
                    </Link>
                    .
                  </span>
                </label>
                <button
                  className="shop-button wide"
                  type="submit"
                  disabled={
                    !settings.enabled ||
                    !quote ||
                    loading ||
                    submitting ||
                    hasUnspecifiedVariant ||
                    !terms
                  }
                >
                  {submitting
                    ? "Изпращане…"
                    : settings.localBrochureOrdering ? "Потвърди поръчката" : "Поръчвам с плащане при доставка"}
                </button>
              </>
            ) : (
              <Link className="shop-button wide" href="/porachka">
                Към завършване <ArrowRight size={17} />
              </Link>
            )}
          </aside>
        </form>
      )}
    </div>
  );
}
