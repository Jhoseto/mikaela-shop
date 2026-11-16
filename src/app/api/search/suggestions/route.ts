import { endpoint } from "@/commerce/http";
import { shopProducts } from "@/ui/shop/data";
import { searchSuggestion } from "@/ui/shop/model";

export async function GET(request: Request) {
  return endpoint(async () => {
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") ?? "").trim().slice(0, 100);
    if (q.length < 2) return { products: [] };
    const matches = await shopProducts({
      q,
      category: params.get("category") || undefined,
      available: params.get("available") === "1",
      promo: params.get("promo") === "1",
      sort: params.get("sort") || "relevance",
      limit: 6,
    });
    return { products: matches.map(searchSuggestion) };
  });
}
