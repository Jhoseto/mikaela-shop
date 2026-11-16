import { CatalogListing, type SearchPromise } from "@/ui/shop/listing";
import {
  shopCategories,
  shopSettings,
  shopProducts,
  origin,
} from "@/ui/shop/data";
import { categoryHref, routeSlug } from "@/ui/shop/model";
type Params = Promise<{ slug: string }>;
export async function generateMetadata({ params }: { params: Params }) {
  const slug = routeSlug((await params).slug),
    c = (await shopCategories()).find((v) => v.slug === slug),
    root = origin(await shopSettings());
  if (!c) return {};
  const image =
    c.image ||
    (root
      ? (await shopProducts({ category: slug, limit: 1 }))[0]?.images[0]
      : undefined);
  return {
    title: c.name,
    description: "Разгледай " + c.name + " в Моят Магазин Микаела.",
    alternates: root ? { canonical: root + categoryHref(slug) } : undefined,
    openGraph: {
      title: c.name,
      images: root && image ? [new URL(image, root).href] : [],
    },
  };
}
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchPromise;
}) {
  return (
    <CatalogListing
      kind="category"
      slug={routeSlug((await params).slug)}
      params={await searchParams}
    />
  );
}
