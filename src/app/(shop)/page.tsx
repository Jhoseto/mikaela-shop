import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock3,
  CreditCard,
  Grid2X2,
  MapPinned,
  ShoppingBasket,
  ShoppingBag,
} from "lucide-react";
import {
  shopSettings,
  shopCategories,
  shopProducts,
  featuredProducts,
  shopBrochure,
  jsonld,
  origin,
} from "@/ui/shop/data";
import { ProductCard } from "@/ui/shop/products";
import { ProductImage } from "@/ui/shop/media";
import {
  categoryHref,
  shortDate,
  type ShopProduct,
  productHref,
  priceText,
} from "@/ui/shop/model";
function ProductSection({
  title,
  products,
  href,
  limit = 4,
}: {
  title: string;
  products: ShopProduct[];
  href: string;
  limit?: number;
}) {
  return products.length ? (
    <section className="home-section">
      <div className="section-heading">
        <h2>{title}</h2>
        <Link className="text-link" href={href}>
          Виж всички <ArrowRight size={16} />
        </Link>
      </div>
      <div className="products-grid">
        {products.slice(0, limit).map((p) => (
          <ProductCard product={p} key={p.id} />
        ))}
      </div>
    </section>
  ) : null;
}
export default async function Home() {
  const [s, cats, products, offers, brochure] = await Promise.all([
    shopSettings(),
    shopCategories(),
    shopProducts({ limit: 32 }),
    shopProducts({ promo: true, limit: 8 }),
    shopBrochure(),
  ]);
  const featureIds = s.featured || [];
  const featured = featureIds.length
    ? await featuredProducts(featureIds)
    : products.filter((p) => !offers.slice(0, 4).some((o) => o.id === p.id));
  const lead = offers.find(
    (p) => p.images.length && p.variants.some((v) => v.available && v.offer),
  );
  const leadV = lead?.variants.find((v) => v.available && v.offer);
  const categoryImages = new Map(
    products
      .filter((p) => p.images.length)
      .map((p) => [p.category.slug, p.images[0]]),
  );
  const site = origin(s);
  return (
    <div className="shop-width home">
      {site && !s.demo && s.address && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonld({
              "@context": "https://schema.org",
              "@type": "GroceryStore",
              name: s.name,
              url: site,
              address: s.address,
              telephone: s.phone,
              image: s.shopPhoto,
            }),
          }}
        />
      )}
      <div className="hero-grid">
        <section className="market-hero">
          <img
            className="hero-image"
            src={s.heroImage || "/design/market-bag.webp"}
            alt=""
            fetchPriority="high"
          />
          <div className="hero-copy">
            <h1>{s.heroTitle || "От квартала до твоята маса."}</h1>
            <p>
              {s.heroText ||
                "Избери продукти от нашия магазин и ги поръчай с доставка до дома."}
            </p>
            <Link href="/produkti" className="shop-button hero-button">
              {s.heroButton || "Започни да пазаруваш"} <ArrowRight size={18} />
            </Link>
          </div>
        </section>
        <div className="hero-side">
          <Link href="/broshura" className="brochure-tile">
            <div>
              <BookOpen className="tile-icon" size={26} />
              <h2>
                Брошурата <br />
                на магазина
              </h2>
              <span>
                {brochure
                  ? shortDate(brochure.starts) +
                    " – " +
                    shortDate(brochure.ends, true)
                  : "Разгледай брошурата"}
              </span>
            </div>
            {brochure?.cover && (
              <img className="cover-thumb" src={brochure.cover} alt="" />
            )}
            <span className="arrow-disc">
              <ArrowUpRight size={19} />
            </span>
          </Link>
          {lead && leadV ? (
            <Link className="lead-offer" href={productHref(lead.slug)}>
              <div>
                <span className="overline">От брошурата</span>
                <h3>{lead.name}</h3>
                <strong>{priceText(leadV)}</strong>
              </div>
              <ProductImage name="" src={lead.images[0]} />
              <span className="arrow-disc">
                <ArrowUpRight size={16} />
              </span>
            </Link>
          ) : (
            <Link className="delivery-tile" href="/informacia/dostavka">
              <MapPinned size={26} />
              <div>
                <h3>Доставка до дома</h3>
                <span>Райони и условия</span>
              </div>
              <ArrowUpRight size={19} />
            </Link>
          )}
        </div>
      </div>
      {!!cats.length && (
        <section className="home-section">
          <div className="section-heading">
            <h2>Категории</h2>
            <Link className="text-link" href="/produkti">
              Целият каталог <ArrowRight size={16} />
            </Link>
          </div>
          <div className="category-strip">
            {cats.map((c) => (
              <Link
                className="category-chip"
                key={c.id}
                href={categoryHref(c.slug)}
              >
                {c.image || categoryImages.has(c.slug) ? (
                  <ProductImage
                    src={c.image || categoryImages.get(c.slug)}
                    name=""
                    small
                  />
                ) : (
                  <Grid2X2 size={18} />
                )}
                <b>{c.name}</b>
              </Link>
            ))}
          </div>
        </section>
      )}
      <ProductSection
        title="От актуалната брошура"
        products={offers}
        href="/promocii"
      />
      <ProductSection
        title="Подбрано от Микаела"
        products={featured}
        href="/produkti"
        limit={featureIds.length || 4}
      />
      {!products.length && (
        <section className="home-section catalog-pending">
          <ShoppingBasket size={30} />
          <div>
            <h2>Подготвяме каталога</h2>
            <p>
              Тук ще откриеш продуктите, потвърдени от магазина за доставка.
            </p>
          </div>
          <Link href="/broshura" className="text-link">
            Към брошурата <ArrowRight size={17} />
          </Link>
        </section>
      )}
      <section className="how-section">
        <h2>Как да поръчаш</h2>
        <div className="how-grid">
          {[
            [
              ShoppingBag,
              "Избери продукти",
              "Добави желаните разновидности и количества в количката.",
            ],
            [
              Clock3,
              "Избери доставка",
              "Въведи адрес и избери свободен ден и часови интервал.",
            ],
            [
              CreditCard,
              "Плати при получаване",
              "Виж сумата и начина на плащане, преди да изпратиш поръчката.",
            ],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof ShoppingBag;
            return (
              <div key={String(title)}>
                <I />
                <section>
                  <h3>{String(title)}</h3>
                  <p>{String(body)}</p>
                </section>
              </div>
            );
          })}
        </div>
      </section>
      {s.shopPhoto && (
        <section className="store-preview">
          <img src={s.shopPhoto} alt="Моят Магазин Микаела" />
          <div>
            <h2>За магазина</h2>
            {s.address && <p>{s.address}</p>}
            {s.hours && <p>{s.hours}</p>}
            <Link className="text-link" href="/informacia/za-magazina">
              Виж повече <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
