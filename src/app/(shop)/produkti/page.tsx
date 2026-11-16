import { CatalogListing, type SearchPromise } from "@/ui/shop/listing";
export const metadata = { title: "Всички продукти" };
export default async function Products({
  searchParams,
}: {
  searchParams: SearchPromise;
}) {
  return <CatalogListing kind="all" params={await searchParams} />;
}
