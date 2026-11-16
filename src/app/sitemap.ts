import type { MetadataRoute } from "next";
import {
  shopSettings,
  origin,
  shopProducts,
  shopCategories,
} from "@/ui/shop/data";
import { productHref, categoryHref, infoPages } from "@/ui/shop/model";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const s = await shopSettings(),
    base = origin(s);
  if (!base || s.demo) return [];
  const pages = [
    "/",
    "/produkti",
    "/promocii",
    "/broshura",
    ...Object.keys(infoPages).map((k) => "/informacia/" + k),
    ...(await shopCategories()).map((c) => categoryHref(c.slug)),
  ];
  let offset = 0;
  while (true) {
    const group = await shopProducts({ limit: 100, offset });
    if (!group.length) break;
    pages.push(...group.map((p) => productHref(p.slug)));
    offset += group.length;
  }
  return pages.map((url) => ({ url: base + url }));
}
