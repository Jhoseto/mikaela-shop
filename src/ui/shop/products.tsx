"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, ChevronRight, CircleX, Tag } from "lucide-react";
import { ProductImage } from "./media";
import { AddControl } from "./quantity";
import "./product-shelf.css";
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

function detailDescription(product: ShopProduct, variant?: ShopVariant) {
  if (!product.description || !(variant?.listingOnly || variant?.localBrochureOrder)) return product.description;
  const text = product.description.replace(/\s+/gu, " ").trim();
  if (text === product.name) return "";
  if (!text.startsWith(product.name + " ")) return text;
  const rest = text.slice(product.name.length).trim();
  const unit = rest.match(/^\(1\s+([^=()]+?)\s*=\s*(\d+[,.]\d+)\s*€\)\s*/u);
  if (unit && variant.unitPrice?.replace(/\s/gu, "") === unit[2] + "€/" + unit[1].trim()) {
    return rest.slice(unit[0].length).replace(/^\*\s*/u, "");
  }
  return rest;
}

function variantLabel(product: ShopProduct, variant: ShopVariant) {
  const name =
    variant.name !== product.name &&
    variant.name !== "За уточняване"
      ? variant.name
      : "";
  return (
    [name, variant.pack].filter(Boolean).join(" · ") ||
    (variant.unit === "kg" ? "На килограм" : "На брой")
  );
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
  const offerTerms = variant.offer?.label;
  const showTerms = offerTerms && !["Цена от брошурата", "Промоционална цена"].includes(offerTerms);
  return (
    <article className={"product-card shelf-card" + (highlight ? " highlight" : "")} data-category={product.category.slug}>
      <Link href={productHref(product.slug)} className="product-image">
        <ProductImage src={product.images[0]} name={product.name} small />
        {variant.offer && (
          <span className={"product-promo" + ((variant.offer.buy ?? 1) > 1 ? " pack-deal" : "")}>
            {(variant.offer.buy ?? 1) > 1 ? (
              <>{variant.offer.buy} за {variant.offer.pay}</>
            ) : (
              <><Tag size={12} aria-hidden />{variant.listingOnly || variant.localBrochureOrder ? "От брошурата" : "Промоция"}</>
            )}
          </span>
        )}
      </Link>
      <div className="product-copy">
        <div className="shelf-meta">
          <span className="product-category">{product.category.name}</span>
          {variant.restricted && <span className="shelf-age" aria-label="Възрастово ограничение 18 плюс">18+</span>}
        </div>
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
              {variantLabel(product, variant)}
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
                    <span>{variantLabel(product, v)}</span>
                    <b>{priceText(v)}</b>
                  </button>
                ))}
              </div>
            </Panel>
          </>
        ) : (
          <p className="product-pack">{variantLabel(product, variant)}</p>
        )}
        {variant.offer && (
          <p className="offer-condition">
            {showTerms ? offerTerms : ""}
            {variant.offer.ends && (showTerms ? " · до " : "До ") + shortDate(variant.offer.ends)}
          </p>
        )}
        <div className="shelf-buy">
        <div className="price-row">
          <strong>{priceText(variant)}</strong>
          {variant.unit !== "kg" && variant.unitPrice && <small>{variant.unitPrice}</small>}
        </div>
        <div className="product-action">
          {variant.listingOnly ? (
            <>
              <span className="stock off">Само за разглеждане</span>
              <Link className="text-link" href={productHref(product.slug)}>
                Виж продукта<span className="sr-only"> {product.name}</span>{" "}
                <ArrowRight size={15} />
              </Link>
            </>
          ) : (
            <>
              {(!variant.localBrochureOrder || !variant.available) && <span className={"stock " + (!variant.available ? "off" : "")}>
                {variant.available ? (
                  <Check size={12} />
                ) : (
                  <CircleX size={12} />
                )}{" "}
                {stockLabel(variant)}
              </span>}
              <AddControl product={product} variant={variant} />
            </>
          )}
        </div>
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
  const description = detailDescription(product, v);
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
          {product.brand && !product.name.toLocaleLowerCase("bg").startsWith(product.brand.toLocaleLowerCase("bg") + " ") && (
            <p className="eyebrow">{product.brand}</p>
          )}
          <h1>{product.name}</h1>
          {description && <p>{description}</p>}
          {v && (
            <>
              {(v.listingOnly || v.localBrochureOrder) && product.variants.length === 1 ? (
                <p className="product-pack">{variantLabel(product, v)}</p>
              ) : (
                <fieldset className="variant-list">
                  <legend>Разновидност и разфасовка</legend>
                  {product.variants.map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      aria-pressed={v.id === e.id}
                      onClick={() => setSelected(e.id)}
                    >
                      {variantLabel(product, e)}
                    </button>
                  ))}
                </fieldset>
              )}
              <p className="detail-price">{priceText(v)}</p>
              {v.unit !== "kg" && v.unitPrice && <p className="muted">{v.unitPrice}</p>}
              {v.offer && (
                <p className="detail-promo">
                  <Tag size={17} />
                  {v.offer.label} · {shortDate(v.offer.starts || "")} –{" "}
                  {shortDate(v.offer.ends, true)}
                </p>
              )}
              {v.listingOnly ? (
                <p className="shop-notice">
                  Временно недостъпен за онлайн поръчка.
                </p>
              ) : (!v.localBrochureOrder || !v.available) && (
                <p className={"stock " + (!v.available ? "off" : "")}>
                  {stockLabel(v)}
                </p>
              )}
              {v.unit === "kg" && !v.listingOnly && (
                <p className="fine">
                  Крайната сума зависи от теглото при претегляне.
                </p>
              )}
              {v.requiresVariantChoice && (
                <p className="fine">Посочи желания вкус, вид или разфасовка в количката.</p>
              )}
              {v.missingFoodLabel && (
                <p className="fine">Провери състава и алергените върху опаковката.</p>
              )}
              {(v.restricted || product.restricted) && (
                <p className="shop-notice">
                  Продукт с възрастово ограничение.
                  {!v.listingOnly && " При предаване се проверява възрастта."}
                </p>
              )}
              {!v.listingOnly && (
                <AddControl large product={product} variant={v} />
              )}
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
