"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  Apple,
  ArrowDownUp,
  ArrowRight,
  Candy,
  Carrot,
  Check,
  Coffee,
  Drumstick,
  Fish,
  Grid2X2,
  House,
  Leaf,
  LoaderCircle,
  Milk,
  Tag,
  Wheat,
  X,
} from "lucide-react";
import { categoryHref, type ShopCategory } from "./model";
import { ProductSearchField } from "./search-box";
import "./catalog-navigation.css";

export type CatalogKind = "all" | "category" | "search" | "promo";
export type FilterValues = {
  q: string;
  sort: string;
  available: boolean;
  promo: boolean;
};
const categoryIcons = {
  "mlechni-produkti": Milk,
  "plodove-zelenchutsi": Apple,
  "meso-kolbasi": Drumstick,
  "hlyab-testeni": Wheat,
  "sladki-soleni": Candy,
  napitki: Coffee,
  "osnovni-hrani": Carrot,
  "dom-grizha": House,
  "riba-i-morski-darove": Fish,
};
function filterHref(
  path: string,
  kind: CatalogKind,
  category: string,
  filters: FilterValues,
) {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (category && !path.startsWith("/kategorii/"))
    params.set("category", category);
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  if (filters.available) params.set("available", "1");
  if (filters.promo && kind !== "promo") params.set("promo", "1");
  return path + (params.size ? "?" + params.toString() : "");
}

export function CatalogFilters({
  kind,
  path,
  initial,
  category,
  categories,
  resultCount,
  children,
}: {
  kind: CatalogKind;
  path: string;
  initial: FilterValues;
  category: string;
  categories: ShopCategory[];
  resultCount: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState(initial);
  const [pending, startTransition] = useTransition();
  const current = useRef(initial);
  const sent = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const initialHref = filterHref(path, kind, category, initial);
  const searching = filters.q.trim() !== initial.q;
  useEffect(() => {
    const onBack = () => {
      clearTimeout(timer.current);
      timer.current = undefined;
      sent.current = [];
      const params = new URLSearchParams(window.location.search);
      const restored = {
        q: params.get("q") || "",
        sort: params.get("sort") || "relevance",
        available: params.get("available") === "1",
        promo:
          window.location.pathname === "/promocii" ||
          params.get("promo") === "1",
      };
      current.current = restored;
      setFilters(restored);
    };
    window.addEventListener("popstate", onBack);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("popstate", onBack);
    };
  }, []);
  useEffect(() => {
    // A previous search can finish while a newer query is still being typed.
    const index = sent.current.lastIndexOf(initialHref);
    if (index >= 0) {
      sent.current.splice(0, index + 1);
      return;
    }
    if (!composing.current && !timer.current && !sent.current.length) {
      current.current = initial;
      setFilters(initial);
    }
  }, [initialHref, initial]);

  function navigate(next: FilterValues) {
    clearTimeout(timer.current);
    timer.current = undefined;
    const href = filterHref(path, kind, category, next);
    if (
      sent.current.at(-1) === href ||
      (!sent.current.length &&
        href === window.location.pathname + window.location.search)
    )
      return;
    sent.current.push(href);
    startTransition(() => router.push(href, { scroll: false }));
  }
  function update(patch: Partial<FilterValues>, delayed = false) {
    const next = { ...current.current, ...patch };
    current.current = next;
    setFilters(next);
    clearTimeout(timer.current);
    timer.current = undefined;
    if (delayed && composing.current) return;
    if (delayed) timer.current = setTimeout(() => navigate(next), 160);
    else navigate(next);
  }
  function categoryUrl(next: string) {
    if (kind === "all" || kind === "category") {
      return filterHref(
        next ? categoryHref(next) : "/produkti",
        kind,
        next,
        filters,
      );
    }
    return filterHref(path, kind, next, filters);
  }
  function clear() {
    clearTimeout(timer.current);
    timer.current = undefined;
    const next = {
      q: "",
      sort: "relevance",
      available: false,
      promo: kind === "promo",
    };
    setFilters(next);
    current.current = next;
    sent.current = [];
    const target = filterHref(
      kind === "category" ? "/produkti" : path,
      kind,
      "",
      next,
    );
    startTransition(() => router.push(target, { scroll: false }));
    input.current?.focus();
  }
  const dirty =
    !!category ||
    !!filters.q ||
    filters.available ||
    (filters.promo && kind !== "promo") ||
    filters.sort !== "relevance";
  const all = [
    { id: "all", slug: "", name: "Всички категории" },
    ...categories,
  ];
  return (
    <div className="catalog-layout">
      <aside className="catalog-side">
        <nav aria-label="Категории продукти">
          <h2>Категории</h2>
          <div className="catalog-category-links">
            {all.map((c) => {
              const Icon = !c.slug
                ? Grid2X2
                : categoryIcons[c.slug as keyof typeof categoryIcons] || Leaf;
              const selected = c.slug === category;
              return (
                <Link
                  key={c.id}
                  href={categoryUrl(c.slug)}
                  scroll={false}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => {
                    clearTimeout(timer.current);
                    timer.current = undefined;
                    sent.current = [];
                  }}
                >
                  <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                  <span>{c.name}</span>
                  {selected && (
                    <ArrowRight
                      size={14}
                      className="category-arrow"
                      aria-hidden="true"
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      </aside>
      <div className="catalog-main">
        <form
          role="search"
          aria-label="Филтри за продукти"
          className="catalog-controls"
          action={path}
          onSubmit={(e) => {
            e.preventDefault();
            if (!composing.current) navigate(current.current);
          }}
        >
          {category && !path.startsWith("/kategorii/") && (
            <input type="hidden" name="category" value={category} />
          )}
          <div className="catalog-search-row">
            <ProductSearchField
              value={filters.q}
              onChange={(q) => update({ q }, true)}
              catalog={{
                category, available: filters.available, promo: filters.promo, sort: filters.sort,
                resultsHref: filterHref(path, kind, category, filters),
                inputRef: input, searching,
                onCompositionStart() {
                  composing.current = true;
                  clearTimeout(timer.current);
                  timer.current = undefined;
                },
                onCompositionEnd(q) {
                  composing.current = false;
                  update({ q }, true);
                },
                onSelect() {
                  clearTimeout(timer.current);
                  timer.current = undefined;
                },
              }}
            />
            <label className="catalog-sort">
              <ArrowDownUp size={16} aria-hidden="true" />
              <span className="sr-only">Сортиране</span>
              <select
                name="sort"
                value={filters.sort}
                onChange={(e) => update({ sort: e.target.value })}
              >
                <option value="relevance">{filters.q ? "Най-точни съвпадения" : "Ред в каталога"}</option>
                <option value="name">По име</option>
                <option value="price-asc">Първо най-евтините</option>
                <option value="price-desc">Първо най-скъпите</option>
              </select>
            </label>
          </div>
          <div className="catalog-filter-row">
            <label className="catalog-toggle">
              <input
                name="available"
                type="checkbox"
                value="1"
                checked={filters.available}
                onChange={(e) => update({ available: e.target.checked })}
              />
              <Check size={15} aria-hidden="true" /> Налични
            </label>
            {kind !== "promo" && (
              <label className="catalog-toggle">
                <input
                  name="promo"
                  type="checkbox"
                  value="1"
                  checked={filters.promo}
                  onChange={(e) => update({ promo: e.target.checked })}
                />
                <Tag size={15} aria-hidden="true" /> Промоции
              </label>
            )}
            {dirty && (
              <button type="button" className="catalog-clear" onClick={clear}>
                <X size={14} aria-hidden="true" /> Изчисти
              </button>
            )}
            {pending && !searching && (
              <LoaderCircle
                className="catalog-loading"
                size={17}
                aria-hidden="true"
              />
            )}
          </div>
        </form>
        <span
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {pending || searching
            ? "Обновяване на продуктите"
            : resultCount + (resultCount === 1 ? " продукт" : " продукта")}
        </span>
        <div aria-busy={pending || searching}>{children}</div>
      </div>
    </div>
  );
}
