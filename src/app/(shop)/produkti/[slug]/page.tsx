import { notFound } from "next/navigation";
import { shopProduct, shopSettings, origin, jsonld } from "@/ui/shop/data";
import { productHref, routeSlug } from "@/ui/shop/model";
import { ProductDetail } from "@/ui/shop/products";
type Params = Promise<{ slug: string }>;
export async function generateMetadata({ params }: { params: Params }) {
  const slug = routeSlug((await params).slug),
    p = await shopProduct(slug),
    root = origin(await shopSettings());
  if (!p) return {};
  return {
    title: p.seo?.title || p.name,
    description:
      p.seo?.description ||
      p.description ||
      [p.name, p.variants[0]?.pack, p.category.name]
        .filter(Boolean)
        .join(" · "),
    alternates: root ? { canonical: root + productHref(slug) } : undefined,
    openGraph: {
      title: p.seo?.title || p.name,
      images: root ? p.images.map((i) => new URL(i, root).href) : [],
    },
  };
}
export default async function ProductPage({ params }: { params: Params }) {
  const slug = routeSlug((await params).slug),
    p = await shopProduct(slug);
  if (!p) notFound();
  const s = await shopSettings(),
    root = origin(s);
  return (
    <>
      {!s.demo && root && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonld({
              "@context": "https://schema.org",
              "@type": "Product",
              name: p.name,
              description: p.description,
              image: p.images.map((i) => new URL(i, root).href),
              brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
              offers: p.variants
                .filter((v) => v.price != null)
                .map((v) => ({
                  "@type": "Offer",
                  sku: v.id,
                  name: [v.name, v.pack].join(" "),
                  priceCurrency: "EUR",
                  price: ((v.price || 0) / 100).toFixed(2),
                  availability:
                    "https://schema.org/" +
                    (v.available ? "InStock" : "OutOfStock"),
                  url: root + productHref(slug),
                })),
            }),
          }}
        />
      )}
      <ProductDetail product={p} />
    </>
  );
}
