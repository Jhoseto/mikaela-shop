"use client";

import Link from "next/link";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, LoaderCircle, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { ProductImage } from "./media";
import { useBasket } from "./basket";
import type { SearchSuggestion } from "./model";
import "./search-box.css";

type Suggestions = { key: string; products: SearchSuggestion[] };

type CatalogScope = {
  category: string;
  available: boolean;
  promo: boolean;
  sort: string;
  resultsHref: string;
  searching: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onCompositionStart: () => void;
  onCompositionEnd: (value: string) => void;
  onSelect: () => void;
};

export function SearchBox() {
  const [value, setValue] = useState("");
  return (
    <Form action="/tarsene" role="search" className="shop-search site-product-search">
      <ProductSearchField value={value} onChange={setValue} />
    </Form>
  );
}

export function ProductSearchField({ value, onChange, catalog }: {
  value: string;
  onChange: (value: string) => void;
  catalog?: CatalogScope;
}) {
  const [engaged, setEngaged] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(-1);
  const [column, setColumn] = useState<"product" | "add">("product");
  const [added, setAdded] = useState<{ variantId: string } | null>(null);
  const [result, setResult] = useState<Suggestions | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const basket = useBasket();
  const term = value.trim();
  const params = new URLSearchParams({ q: term });
  if (catalog?.category) params.set("category", catalog.category);
  if (catalog?.available) params.set("available", "1");
  if (catalog?.promo) params.set("promo", "1");
  if (catalog && catalog.sort !== "relevance") params.set("sort", catalog.sort);
  const queryKey = params.toString();
  const eligible = engaged && !composing && term.length >= 2;
  const open = eligible && result?.key === queryKey;
  const products = result?.key === queryKey ? result.products : [];
  const listId = catalog ? "catalog-search-options" : "site-search-options";
  const activeProduct = open ? products[active] : undefined;
  const addSelected = column === "add" && !!activeProduct?.variant;
  const activeCell = activeProduct ? listId + "-" + active + (addSelected ? "-add" : "") : undefined;

  useEffect(() => {
    if (!eligible) return;
    const request = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/search/suggestions?" + queryKey, {
          signal: request.signal,
        });
        if (!response.ok) return;
        const { products }: { products: SearchSuggestion[] } = await response.json();
        if (!request.signal.aborted) setResult({ key: queryKey, products });
      } catch {
        // Enter and the submit button still open the full catalog search.
      }
    }, 160);
    return () => {
      window.clearTimeout(timer);
      request.abort();
    };
  }, [eligible, queryKey]);

  useEffect(() => {
    if (!engaged) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !field.current?.contains(event.target)) {
        setEngaged(false);
        setActive(-1);
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [engaged]);

  useEffect(() => {
    if (activeCell) {
      document.getElementById(activeCell)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeCell]);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(null), 1000);
    return () => window.clearTimeout(timer);
  }, [added]);

  function canAdd({ variant }: SearchSuggestion) {
    if (!basket.ready || !variant) return false;
    if (variant.max == null) return true;
    const quantity = basket.lines.find((line) => line.variantId === variant.id)?.quantity ?? 0;
    return Math.round((quantity + variant.step) * 1000) / 1000 <= variant.max;
  }

  function addProduct(product: SearchSuggestion) {
    if (!product.variant || !canAdd(product)) return;
    basket.add({
      name: product.name,
      slug: product.slug,
      images: product.image ? [product.image] : [],
    }, product.variant);
    setAdded({ variantId: product.variant.id });
  }

  function dismiss() {
    setEngaged(false);
    setActive(-1);
  }
  function select() {
    catalog?.onSelect();
    dismiss();
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === "Escape" && engaged) {
      event.preventDefault();
      dismiss();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (term.length < 2) return;
      event.preventDefault();
      setEngaged(true);
      if (active < 0) setColumn("product");
      if (products.length) setActive((i) => event.key === "ArrowDown"
        ? (i + 1) % products.length
        : (i <= 0 ? products.length - 1 : i - 1));
    } else if (activeProduct && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      if (event.key === "ArrowRight" && activeProduct.variant && !addSelected) {
        event.preventDefault();
        setColumn("add");
      } else if (event.key === "ArrowLeft" && addSelected) {
        event.preventDefault();
        setColumn("product");
      } else {
        setActive(-1);
      }
    } else if (event.key === "Enter") {
      if (activeProduct) {
        event.preventDefault();
        if (addSelected) {
          addProduct(activeProduct);
        } else {
          select();
          router.push(activeProduct.href);
        }
      } else {
        dismiss();
      }
    }
  }

  return (
    <div ref={field} className={catalog ? "catalog-search" : "header-search-field"}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
      }}>
      {catalog?.searching ? <LoaderCircle size={19} className="catalog-loading" aria-hidden="true" /> : <Search size={catalog ? 19 : 20} aria-hidden="true" />}
      <label className="sr-only" htmlFor="site-search">{catalog ? "Търси в продуктите" : "Търсене на продукти"}</label>
      <input ref={catalog?.inputRef} id="site-search" name="q" type="search" role="combobox"
        autoComplete="off" enterKeyHint="search" maxLength={100}
        placeholder={catalog ? "Търси продукт или марка" : "Потърси продукт или марка…"} value={value}
        aria-autocomplete="list" aria-haspopup="grid" aria-expanded={open && products.length > 0}
        aria-controls={open && products.length ? listId : catalog ? "catalog-results" : undefined}
        aria-activedescendant={activeCell}
        onCompositionStart={() => { setComposing(true); catalog?.onCompositionStart(); }}
        onCompositionEnd={(event) => { setComposing(false); catalog?.onCompositionEnd(event.currentTarget.value); }}
        onChange={(event) => { onChange(event.target.value); setActive(-1); setEngaged(true); }}
        onFocus={() => setEngaged(true)} onClick={() => setEngaged(true)} onKeyDown={navigate}
      />
      {!catalog && <button type="submit" aria-label="Търси"><ArrowRight size={18} /></button>}
      {open && (
        <div className="site-search-popup" onMouseDown={(event) => {
          // Keep the query focused when adding an item from the popup.
          if (event.button === 0) event.preventDefault();
        }}>
          {products.length ? (
            <>
              <ul id={listId} role="grid" aria-label="Предложения за продукти">
                {products.map((p, i) => {
                  const cellId = listId + "-" + i;
                  const justAdded = !!p.variant && added?.variantId === p.variant.id;
                  const enabled = canAdd(p);
                  const addLabel = "Добави " + p.name + " в количката";
                  return (
                    <li key={p.id} role="row">
                      <div role="gridcell" id={cellId} aria-selected={activeCell === cellId}>
                        <Link href={p.href} className="site-search-product" tabIndex={-1} prefetch={false} onClick={select}>
                          <span className="site-search-thumb" aria-hidden="true"><ProductImage src={p.image} name="" small /></span>
                          <span className="site-search-name">{p.name}</span>
                          {p.price && <strong className="site-search-price">{p.price}</strong>}
                        </Link>
                      </div>
                      <div role="gridcell" id={cellId + "-add"} aria-selected={activeCell === cellId + "-add"}>
                        {p.variant && (
                          <button type="button" className="site-search-add" disabled={!enabled}
                            aria-label={addLabel} title={enabled ? addLabel : "Достигнато е максималното количество"}
                            tabIndex={-1} data-added={justAdded || undefined} onClick={() => addProduct(p)}>
                            {justAdded ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Link className="site-search-all" onClick={select}
                href={catalog ? catalog.resultsHref + "#catalog-results" : { pathname: "/tarsene", query: { q: term } }}>
                Всички резултати <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </>
          ) : <p role="status" className="site-search-empty">Няма намерени продукти.</p>}
        </div>
      )}
    </div>
  );
}
