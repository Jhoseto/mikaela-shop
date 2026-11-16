import { CatalogListing, type SearchPromise } from "@/ui/shop/listing";
export const metadata = {
  title: "Търсене",
  robots: { index: false, follow: true },
};
export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchPromise;
}) {
  return <CatalogListing kind="search" params={await searchParams} />;
}
