import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, Search } from "lucide-react";
import { shopCategories, shopProducts } from "./data";
import { ProductCard } from "./products";
import {
  CatalogFilters,
  type CatalogKind,
  type FilterValues,
} from "./catalog-filters";

type SearchParams = Record<string, string | string[] | undefined>;
export type SearchPromise = Promise<SearchParams>;
const first = (v: SearchParams[string]) => (typeof v === "string" ? v : "");
const PAGE_SIZE = 24;

export async function CatalogListing({
  kind,
  params,
  slug,
}: {
  kind: CatalogKind;
  params: SearchParams;
  slug?: string;
}) {
  const categories = await shopCategories();
  const category = slug || first(params.category);
  const active = categories.find((c) => c.slug === category);
  if (slug && !active) notFound();
  const filters: FilterValues = {
    q: first(params.q).trim().slice(0, 100),
    sort: first(params.sort) || "relevance",
    available: first(params.available) === "1",
    promo: kind === "promo" || first(params.promo) === "1",
  };
  const filtered = Boolean(filters.q || category || filters.available || filters.promo);
  const path = slug
    ? "/kategorii/" + encodeURIComponent(slug)
    : kind === "search"
      ? "/tarsene"
      : kind === "promo"
        ? "/promocii"
        : "/produkti";
  const rows = await shopProducts({
    ...filters,
    category: category || undefined,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(
    pages,
    Math.max(1, Math.trunc(Number(first(params.page)) || 1)),
  );
  const title =
    kind === "category" && active
      ? active.name
      : kind === "search"
        ? filters.q
          ? "Резултати за „" + filters.q + "“"
          : "Търсене"
        : kind === "promo"
          ? "Актуални промоции"
          : "Всички продукти";
  const pageHref = (n: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== "page" && typeof value === "string" && value)
        search.set(key, value);
    }
    if (n > 1) search.set("page", String(n));
    return path + (search.size ? "?" + search : "");
  };
  const start = (page - 1) * PAGE_SIZE;
  return (
    <div className="shop-width catalog-page">
      <nav className="breadcrumbs" aria-label="Път до страницата">
        <Link href="/">Начало</Link>
        <ChevronRight aria-hidden="true" />
        {kind === "category" && (
          <>
            <Link href="/produkti">Всички продукти</Link>
            <ChevronRight aria-hidden="true" />
          </>
        )}
        <span aria-current="page">{title}</span>
      </nav>
      <div className="catalog-heading">
        <h1>{title}</h1>
        <span>
          {rows.length} {rows.length === 1 ? "продукт" : "продукта"}
        </span>
      </div>
      <CatalogFilters
        kind={kind}
        initial={filters}
        category={category}
        categories={categories}
        path={path}
        resultCount={rows.length}
      >
        {rows.length ? (
          <div className="products-grid catalog-products" id="catalog-results">
            {rows.slice(start, start + PAGE_SIZE).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="empty-state" id="catalog-results">
            <Search aria-hidden="true" />
            <h2>
              {kind === "promo" && !filters.q && !category && !filters.available
                ? "Няма активни промоции"
                : filtered ? "Няма продукти с този избор" : "В момента няма продукти"}
            </h2>
            <Link className="text-link" href={filtered ? "/produkti" : "/"}>
              {filtered ? "Към всички продукти" : "Към началото"} <ArrowRight size={16} />
            </Link>
          </div>
        )}
        {pages > 1 && (
          <nav className="pagination" aria-label="Страници">
            {page > 1 && (
              <Link href={pageHref(page - 1)}>
                <ArrowLeft size={16} /> Предишна
              </Link>
            )}
            <span>
              Страница {page} от {pages}
            </span>
            {page < pages && (
              <Link href={pageHref(page + 1)}>
                Следваща <ArrowRight size={16} />
              </Link>
            )}
          </nav>
        )}
      </CatalogFilters>
    </div>
  );
}
