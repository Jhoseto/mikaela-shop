import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { shopCategories, shopProducts } from "./data";
import { ProductCard } from "./products";
type SearchParams = Record<string, string | string[] | undefined>;
export type SearchPromise = Promise<SearchParams>;
const first = (v: SearchParams[string]) => (typeof v === "string" ? v : "");
export async function CatalogListing({
  kind,
  params,
  slug,
}: {
  kind: "all" | "category" | "search" | "promo";
  params: SearchParams;
  slug?: string;
}) {
  const cats = await shopCategories(),
    active = slug && cats.find((c) => c.slug === slug);
  if (slug && !active) notFound();
  const q = first(params.q).trim().slice(0, 120),
    category = slug || first(params.category),
    sort = first(params.sort) || "relevance";
  const available = first(params.available) === "1",
    promo = kind === "promo" || first(params.promo) === "1";
  const page = Math.max(
    1,
    Math.min(2000, Math.trunc(Number(first(params.page)) || 1)),
  );
  const path =
    kind === "category"
      ? "/kategorii/" + encodeURIComponent(slug!)
      : kind === "search"
        ? "/tarsene"
        : kind === "promo"
          ? "/promocii"
          : "/produkti";
  const rows = await shopProducts({
    q,
    category: category || undefined,
    promo,
    available,
    sort,
    limit: 25,
    offset: (page - 1) * 24,
  });
  const title = active
    ? active.name
    : kind === "search"
      ? q
        ? "Резултати за „" + q + "“"
        : "Търсене"
      : kind === "promo"
        ? "Актуални промоции"
        : "Всички продукти";
  const href = (n: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params))
      if (typeof v === "string" && k !== "page") u.set(k, v);
    u.set("page", String(n));
    return path + "?" + u.toString();
  };
  return (
    <div className="shop-width inner-page">
      <nav className="breadcrumbs">
        <Link href="/">Начало</Link>
        <ChevronRight />
        {active && (
          <>
            <Link href="/produkti">Продукти</Link>
            <ChevronRight />
          </>
        )}
        {title}
      </nav>
      <div className="page-title">
        <h1>{title}</h1>
      </div>
      <form className="filter-bar" action={path}>
        <label className="filter-search">
          <Search size={18} />
          <span className="sr-only">Търси</span>
          <input
            name="q"
            type="search"
            defaultValue={q}
            maxLength={120}
            placeholder="Търси в продуктите"
          />
        </label>
        {!slug && (
          <label>
            <span className="sr-only">Категория</span>
            <select name="category" defaultValue={category}>
              <option value="">Всички категории</option>
              {cats.map((c) => (
                <option value={c.slug} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span className="sr-only">Сортиране</span>
          <select name="sort" defaultValue={sort}>
            <option value="relevance">По релевантност</option>
            <option value="name">По име</option>
            <option value="price-asc">Цена, възходяща</option>
            <option value="price-desc">Цена, низходяща</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="available"
            value="1"
            defaultChecked={available}
          />{" "}
          Налични
        </label>
        {kind !== "promo" && (
          <label className="check">
            <input
              type="checkbox"
              name="promo"
              value="1"
              defaultChecked={promo}
            />{" "}
            Промоции
          </label>
        )}
        <button className="shop-button small">
          <SlidersHorizontal size={16} /> Приложи
        </button>
      </form>
      {rows.length ? (
        <div className="products-grid">
          {rows.slice(0, 24).map((p) => (
            <ProductCard product={p} key={p.id} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Search />
          <h2>
            {q || category || available
              ? "Няма продукти с този избор"
              : "Все още няма публикувани продукти тук"}
          </h2>
          <Link className="text-link" href="/produkti">
            Към всички продукти <ArrowRight size={16} />
          </Link>
        </div>
      )}
      {(page > 1 || rows.length > 24) && (
        <nav className="pagination" aria-label="Страници">
          {page > 1 && (
            <Link href={href(page - 1)}>
              <ArrowLeft size={16} /> Предишна
            </Link>
          )}
          <span>Страница {page}</span>
          {rows.length > 24 && (
            <Link href={href(page + 1)}>
              Следваща <ArrowRight size={16} />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
