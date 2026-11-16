import { CatalogListing, type SearchPromise } from "@/ui/shop/listing";
export const metadata = { title: "Актуални промоции" };
export default async function Promotions({
  searchParams,
}: {
  searchParams: SearchPromise;
}) {
  return <CatalogListing kind="promo" params={await searchParams} />;
}
