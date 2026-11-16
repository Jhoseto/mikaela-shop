"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Panel } from "./panel";
import { SearchBox } from "./search-box";
import "./catalog-navigation.css";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Grid2X2,
  MapPin,
  Menu,
  ShoppingBasket,
  Store,
  Truck,
} from "lucide-react";
import { useBasket } from "./basket";
import {
  basketVariantLabel,
  infoPages,
  money,
  productHref,
  type ShopSettings,
  type ShopZone,
} from "./model";
import { Quantity } from "./quantity";
import { ProductImage } from "./media";

const navigation = [
  ["/produkti", "Всички продукти"],
  ["/promocii", "Промоции"],
  ["/broshura", "Брошура"],
  ["/informacia/dostavka", "Доставка"],
  ["/informacia/za-magazina", "За магазина"],
];
export function ShopName({ settings }: { settings: ShopSettings }) {
  return (
    <Link className="shop-wordmark" href="/">
      {settings.logo ? (
        <img src={settings.logo} alt={settings.name} />
      ) : (
        <>
          <span className="wordmark-small">Моят магазин</span>
          <strong>
            Микаела<span>.</span>
          </strong>
        </>
      )}
      <span className="sr-only"> — Начало</span>
    </Link>
  );
}
export function parseZones(raw: unknown): ShopZone[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((z) => ({
    id: String(z.id),
    name: String(z.name),
    fee: Number(z.fee_cents ?? 0),
    minimum: Number(z.min_cents ?? 0),
    freeFrom: z.free_cents ?? null,
  }));
}
export function AreaChooser({
  onChosen,
}: {
  onChosen?: () => void;
}) {
  const cart = useBasket();
  const [zones, setZones] = useState<ShopZone[] | null>(null),
    [selected, setSelected] = useState(cart.zone),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/delivery", { signal: abort.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((o) => {
        setZones(parseZones(o.zones));
        setError("");
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("Районите не се заредиха.");
      });
    return () => abort.abort();
  }, [retry]);
  const zone = zones?.find((z) => z.id === selected);
  return (
    <div className="zone-chooser">
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            Опитай отново
          </button>
        </p>
      ) : zones === null ? (
        <p role="status">Зареждане…</p>
      ) : !zones.length ? (
        <p className="shop-notice">
          В момента няма обслужвани райони.
        </p>
      ) : (
        <>
          <label className="field">
            Населено място или район
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Избери…</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          {zone && (
            <>
              <dl className="totals">
                <div>
                  <dt>Минимална поръчка</dt>
                  <dd>{money(zone.minimum)}</dd>
                </div>
                <div>
                  <dt>Доставка</dt>
                  <dd>{money(zone.fee)}</dd>
                </div>
                {zone.freeFrom != null && (
                  <div>
                    <dt>Безплатна от</dt>
                    <dd>{money(zone.freeFrom)}</dd>
                  </div>
                )}
              </dl>
              <button
                className="shop-button"
                onClick={() => {
                  cart.setZone(zone.id);
                  onChosen?.();
                }}
              >
                <Check size={16} /> Избери район
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
export function Header({ settings }: { settings: ShopSettings }) {
  const [panel, setPanel] = useState<"cart" | "zone" | "nav" | null>(null);
  const path = usePathname(),
    cart = useBasket();
  const catalogPage =
    ["/produkti", "/promocii", "/tarsene"].includes(path) ||
    path.startsWith("/kategorii/");
  useEffect(() => {
    setPanel(null);
  }, [path]);
  const close = () => setPanel(null);
  return (
    <>
      <a className="skip-link" href="#main-shop">
        Към основното съдържание
      </a>
      <div className="shop-top primary-service-strip">
        <div className="shop-width">
          <span className="delivery-deadline">
            <Truck size={15} aria-hidden="true" />
            Поръчки за доставка до офиса и дома се приемат до 20:00&nbsp;ч.
          </span>
          <button
            onClick={() => setPanel("zone")}
            aria-label="Провери района за доставка"
          >
            <MapPin size={14} />
            <span className="region-desktop">Провери района за доставка</span>
            <span className="region-mobile">Провери района</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
      <header className="shop-header primary-masthead">
        <div
          className={
            "shop-width primary-header-row" +
            (catalogPage ? " catalog-masthead" : "")
          }
        >
          <button
            className="icon-button mobile-nav"
            onClick={() => setPanel("nav")}
            aria-label="Отвори менюто"
          >
            <Menu />
          </button>
          <ShopName settings={settings} />
          <nav className="primary-nav" aria-label="Основна навигация">
            {navigation.map(([url, text], i) => {
              const selected =
                i === 0
                  ? path === "/produkti" ||
                    path.startsWith("/kategorii/") ||
                    path.startsWith("/produkti/")
                  : path === url;
              return (
                <Link
                  key={url}
                  href={url}
                  aria-current={selected ? "page" : undefined}
                >
                  {i === 0 && <Grid2X2 size={16} aria-hidden="true" />}
                  {text}
                </Link>
              );
            })}
          </nav>
          {!catalogPage && <SearchBox key={path} />}
          <button className="basket-trigger" onClick={() => setPanel("cart")}>
            <ShoppingBasket size={23} />
            <span>
              <small>Количка</small>
              <b>{money(cart.total)}</b>
            </span>
            <i>{cart.count}</i>
            <span className="sr-only"> артикула</span>
          </button>
        </div>
      </header>
      <button
        type="button"
        className="mobile-cart"
        onClick={() => setPanel("cart")}
      >
        <ShoppingBasket size={21} />
        <span>
          Количка <b>{cart.count}</b>
        </span>
        <strong>{money(cart.total)}</strong>
        <span className="sr-only"> — Отвори количката</span>
      </button>
      <Panel title="Твоята количка" open={panel === "cart"} close={close}>
        <div className="panel-body">
          {!cart.lines.length ? (
            <div className="empty-state">
              <ShoppingBasket />
              <h3>Количката е празна</h3>
              <Link className="shop-button" href="/produkti" onClick={close}>
                Разгледай продуктите <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <>
              {cart.lines.map((l) => (
                <div key={l.variantId} className="mini-item">
                  <ProductImage src={l.image} name={l.title} />
                  <div>
                    <Link href={productHref(l.productSlug)} onClick={close}>
                      {l.title}
                    </Link>
                    <small>{basketVariantLabel(l)}</small>
                    <Quantity
                      id={l.variantId}
                      qty={l.quantity}
                      step={l.step}
                      max={l.max}
                      unit={l.unit}
                      label={l.title}
                    />
                  </div>
                  <b>{money(cart.lineTotals[l.variantId])}</b>
                </div>
              ))}
              <dl className="totals">
                <div>
                  <dt>Продукти, ориентировъчно</dt>
                  <dd>{money(cart.total)}</dd>
                </div>
              </dl>
              <Link
                className="shop-button wide"
                href="/kolichka"
                onClick={close}
              >
                Към количката <ArrowRight size={17} />
              </Link>
            </>
          )}
        </div>
      </Panel>
      <Panel
        title="Район за доставка"
        open={panel === "zone"}
        close={close}
        side="center"
      >
        <div className="panel-body">
          <AreaChooser onChosen={close} />
        </div>
      </Panel>
      <Panel title="Меню" open={panel === "nav"} close={close}>
        <nav className="panel-nav">
          {navigation.map(([url, text]) => (
            <Link key={url} href={url} onClick={close}>
              {text}
              <ChevronRight size={17} />
            </Link>
          ))}
          <Link href="/informacia/kontakti" onClick={close}>
            Контакти
            <ChevronRight size={17} />
          </Link>
        </nav>
      </Panel>
    </>
  );
}
export function Footer({ settings }: { settings: ShopSettings }) {
  return (
    <footer className="shop-footer">
      <div className="shop-width footer-grid">
        <div>
          <ShopName settings={settings} />
          {settings.company && <p><Store size={16} /> {settings.company}</p>}
          {settings.address && (
            <p>
              <MapPin size={16} />
              {settings.address}
            </p>
          )}
          {settings.hours && (
            <p>
              <Clock size={16} />
              {settings.hours}
            </p>
          )}
        </div>
        <div>
          <h3>Пазаруване</h3>
          {navigation.slice(0, 4).map(([url, text]) => (
            <Link href={url} key={url}>
              {text}
            </Link>
          ))}
        </div>
        <div>
          <h3>За магазина</h3>
          {Object.entries(infoPages)
            .filter(([k]) => !["dostavka", "kontakti"].includes(k))
            .map(([slug, title]) => (
              <Link href={"/informacia/" + slug} key={slug}>
                {title}
              </Link>
            ))}
        </div>
        <div>
          <h3>Контакти</h3>
          {settings.phone && (
            <a href={"tel:" + settings.phone}>{settings.phone}</a>
          )}
          {settings.email && (
            <a href={"mailto:" + settings.email}>{settings.email}</a>
          )}
          <Link href="/informacia/kontakti">
            Виж контактите <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </footer>
  );
}
