"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, ChevronRight, CircleX, Tag } from "lucide-react";
import { ProductImage } from "./media";
import { AddControl } from "./quantity";
import { Panel } from "./panel";
import {
  categoryHref,
  priceText,
  productHref,
  shortDate,
  type ShopProduct,
  type ShopVariant,
} from "./model";

function stockLabel(variant: ShopVariant) {
  if (variant.inStock === false) return "Изчерпан";
  return variant.available ? "Наличен" : "Временно недостъпен";
}

export function ProductCard({
  product,
  highlight = false,
}: {
  product: ShopProduct;
  highlight?: boolean;
}) {
  const [selected, setSelected] = useState(
    product.variants.find((v) => v.available)?.id || product.variants[0]?.id,
  );
  const [choosing, setChoosing] = useState(false);
  const variant =
    product.variants.find((v) => v.id === selected) || product.variants[0];
  if (!variant) return null;
  return (
    <article className={"product-card" + (highlight ? " highlight" : "")}>
      <Link href={productHref(product.slug)} className="product-image">
        <ProductImage src={product.images[0]} name={product.name} small />
        {variant.offer && (
          <span className="product-promo">
            <Tag size={12} /> Промоция
          </span>
        )}
      </Link>
      <div className="product-copy">
        <span className="product-category">{product.category.name}</span>
        <h3>
          <Link href={productHref(product.slug)}>{product.name}</Link>
        </h3>
        {product.variants.length > 1 ? (
          <>
            <button
              type="button"
              aria-haspopup="dialog"
              className="variant-trigger flex items-center justify-between gap-1 rounded-lg border px-2 py-1 text-left text-sm"
              onClick={() => setChoosing(true)}
            >
              {[variant.name, variant.pack].filter(Boolean).join(" · ")}
              <span className="sr-only">
                {" "}
                — Избери разновидност на {product.name}
              </span>
              <ChevronRight size={14} />
            </button>
            <Panel
              title={product.name}
              open={choosing}
              close={() => setChoosing(false)}
            >
              <div className="panel-body grid gap-2">
                <p className="mb-1">Избери разновидност и разфасовка</p>
                {product.variants.map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    aria-pressed={variant.id === v.id}
                    className="variant-option flex min-h-12 items-center justify-between gap-2 rounded-xl border p-3 text-left"
                    onClick={() => {
                      setSelected(v.id);
                      setChoosing(false);
                    }}
                  >
                    <span>{[v.name, v.pack].filter(Boolean).join(" · ")}</span>
                    <b>{priceText(v)}</b>
                  </button>
                ))}
              </div>
            </Panel>
          </>
        ) : (
          <p className="product-pack">
            {[variant.name !== product.name ? variant.name : "", variant.pack]
              .filter(Boolean)
              .join(" · ") ||
              (variant.unit === "kg" ? "На килограм" : "На брой")}
          </p>
        )}
        {variant.offer && (
          <p className="offer-condition">
            {variant.offer.label}
            {variant.offer.ends && " · до " + shortDate(variant.offer.ends)}
          </p>
        )}
        <div className="price-row">
          <strong>{priceText(variant)}</strong>
          {variant.unitPrice && <small>{variant.unitPrice}</small>}
        </div>
        <div className="product-action">
          <span className={"stock " + (!variant.available ? "off" : "")}>
            {variant.available ? <Check size={12} /> : <CircleX size={12} />}{" "}
            {stockLabel(variant)}
          </span>
          <AddControl product={product} variant={variant} />
        </div>
      </div>
    </article>
  );
}
export function ProductDetail({ product }: { product: ShopProduct }) {
  const [selected, setSelected] = useState(
    product.variants.find((v) => v.available)?.id || product.variants[0]?.id,
  );
  const [img, setImg] = useState(0);
  const v =
    product.variants.find((i) => i.id === selected) || product.variants[0];
  const details = v?.details ?? product.details;
  const nutrients: Record<string, string> = {
    ingredients: "Състав",
    allergens: "Алергени",
    storage: "Съхранение",
    nutrition: "Хранителни стойности",
    net: "Нетно количество",
    netQuantity: "Нетно количество",
    origin: "Произход",
    manufacturer: "Производител",
    instructions: "Начин на употреба",
    operator: "Отговорен оператор",
    net_quantity: "Нетно количество",
  };
  return (
    <div className="shop-width inner-page">
      <nav className="breadcrumbs">
        <Link href="/">Начало</Link>
        <ChevronRight />
        <Link href="/produkti">Продукти</Link>
        <ChevronRight />
        <Link href={categoryHref(product.category.slug)}>
          {product.category.name}
        </Link>
      </nav>
      <div className="detail-grid">
        <div>
          <div className="detail-image">
            <ProductImage src={product.images[img]} name={product.name} eager />
          </div>
          {product.images.length > 1 && (
            <div className="thumbs">
              {product.images.map((url, i) => (
                <button
                  key={url}
                  aria-pressed={img === i}
                  onClick={() => setImg(i)}
                  aria-label={"Снимка " + (i + 1)}
                >
                  <ProductImage src={url} name="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="detail-info">
          <p className="eyebrow">{product.brand || product.category.name}</p>
          <h1>{product.name}</h1>
          {product.description && <p>{product.description}</p>}
          {v && (
            <>
              <fieldset className="variant-list">
                <legend>Разновидност и разфасовка</legend>
                {product.variants.map((e) => (
                  <button
                    type="button"
                    key={e.id}
                    aria-pressed={v.id === e.id}
                    onClick={() => setSelected(e.id)}
                  >
                    {[e.name, e.pack].filter(Boolean).join(" · ") ||
                      (e.unit === "kg" ? "На килограм" : "На брой")}
                  </button>
                ))}
              </fieldset>
              <p className="detail-price">{priceText(v)}</p>
              {v.unitPrice && <p className="muted">{v.unitPrice}</p>}
              {v.offer && (
                <p className="detail-promo">
                  <Tag size={17} />
                  {v.offer.label} · {shortDate(v.offer.starts || "")} –{" "}
                  {shortDate(v.offer.ends, true)}
                </p>
              )}
              <p className={"stock " + (!v.available ? "off" : "")}>
                {stockLabel(v)}
              </p>
              {v.unit === "kg" && (
                <p className="fine">
                  Сумата е ориентировъчна. Крайната цена се определя от
                  действително подготвеното тегло.
                </p>
              )}
              {(v.restricted || product.restricted) && (
                <p className="shop-notice">
                  Продукт с възрастово ограничение. При предаване се проверява
                  възрастта.
                </p>
              )}
              <AddControl large product={product} variant={v} />
            </>
          )}
        </div>
      </div>
      {!!Object.keys(details).length && (
        <section className="product-details">
          <h2>Информация за продукта</h2>
          <dl>
            {Object.entries(details).map(([k, val]) => (
              <div key={k}>
                <dt>{nutrients[k] || k}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <Link className="text-link" href={categoryHref(product.category.slug)}>
        Още от {product.category.name} <ArrowRight size={16} />
      </Link>
    </div>
  );
}
