import Link from "next/link";
import { ArrowRight, BookOpen, Grid2X2 } from "lucide-react";
import { featuredProducts, jsonld, origin, shopBrochure, shopCategories, shopSettings } from "@/ui/shop/data";
import { carouselCatalog, publicCarousel } from "@/ui/shop/carousel-data";
import { categoryHref, shortDate, type ShopProduct } from "@/ui/shop/model";
import { ProductCard } from "@/ui/shop/products";
import { ProductImage } from "@/ui/shop/media";
import { BrochureHero, ShelfReveal } from "@/ui/shop/brochure-hero";
import { BreakfastShelf } from "@/ui/shop/breakfast-shelf";

function ProductSection({ title, products, href, limit = 4 }: { title: string; products: ShopProduct[]; href: string; limit?: number }) {
  if (!products.length) return null;
  return (
    <ShelfReveal className="edition-section">
      <section>
        <div className="edition-section-heading">
          <h2>{title}</h2>
          <Link className="edition-more" href={href}>Виж всички <ArrowRight size={16} /></Link>
        </div>
        <div className="products-grid">
          {products.slice(0, limit).map((p) => <ProductCard product={p} key={p.id} />)}
        </div>
      </section>
    </ShelfReveal>
  );
}

export default async function Home() {
  const [s, cats, catalog, brochure] = await Promise.all([
    shopSettings(), shopCategories(), carouselCatalog(), shopBrochure(),
  ]);
  const products = catalog.products;
  const offers = products.filter((p) => p.variants.some((v) => v.offer));
  const dates = brochure ? shortDate(brochure.starts) + " – " + shortDate(brochure.ends, true) : "";
  const carousel = await publicCarousel(catalog, s, dates);
  const firstOffers = offers.slice(0, 4);
  const featured = s.featured?.length ? await featuredProducts(s.featured)
    : products.filter((p) => !firstOffers.some((off) => off.id === p.id) && p.variants.some((v) => v.available));
  const categoryImages = new Map<string, string>();
  for (const p of products) {
    if (!categoryImages.has(p.category.slug) && p.images[0] && !p.restricted) categoryImages.set(p.category.slug, p.images[0]);
  }
  const site = origin(s);
  return (
    <div className="shop-width edition-home">
      {site && !s.demo && !s.localBrochureOrdering && s.address && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonld({
          "@context": "https://schema.org", "@type": "GroceryStore", name: s.name, url: site, address: s.address, telephone: s.phone, image: s.shopPhoto,
        }) }} />
      )}
      {carousel.slides.length
        ? <BrochureHero {...carousel} dates={dates} />
        : <h1 className="sr-only">{s.name}</h1>}
      {cats.length > 0 && (
        <ShelfReveal className="edition-section edition-category-section">
          <section>
            <div className="edition-section-heading">
              <h2>Категории</h2>
              <Link className="edition-more" href="/produkti">Целият каталог <ArrowRight size={16} /></Link>
            </div>
            <nav className="edition-categories" aria-label="Продуктови категории">
              {cats.map((c) => {
                const image = c.image || categoryImages.get(c.slug);
                return <Link href={categoryHref(c.slug)} key={c.id}>
                  <span className="edition-category-art">{image
                    ? <ProductImage name="" src={image} small />
                    : <Grid2X2 size={24} aria-hidden="true" />}</span>
                  <b>{c.name}</b>
                </Link>;
              })}
            </nav>
          </section>
        </ShelfReveal>
      )}
      <ProductSection title="Предложения от брошурата" products={firstOffers} href="/promocii" />
      <BreakfastShelf products={products} />
      {brochure && (
        <ShelfReveal className="edition-section">
          <section className="edition-print">
            {brochure.cover && <div className="edition-print-cover"><img src={brochure.cover} alt="Корица на актуалната брошура" loading="lazy" /></div>}
            <div>
              <p className="edition-print-date"><BookOpen size={16} />{dates}</p>
              <h2>Брошурата на Моят Магазин</h2>
            </div>
            <a href={brochure.pdf} target="_blank" rel="noreferrer" className="edition-outline">
              Разгърни брошурата <ArrowRight size={16} />
            </a>
          </section>
        </ShelfReveal>
      )}
      <ProductSection title="Подбрано от Микаела" products={featured} href="/produkti" limit={s.featured?.length || 4} />
      {s.shopPhoto && (
        <section className="store-preview">
          <img src={s.shopPhoto} alt="Моят Магазин Микаела" />
          <div>
            <h2>За магазина</h2>
            {s.address && <p>{s.address}</p>}
            {s.hours && <p>{s.hours}</p>}
            <Link className="edition-more" href="/informacia/za-magazina">За магазина <ArrowRight size={16} /></Link>
          </div>
        </section>
      )}
    </div>
  );
}
