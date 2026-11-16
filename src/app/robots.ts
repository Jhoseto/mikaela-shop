import type { MetadataRoute } from "next";
import { shopSettings, origin } from "@/ui/shop/data";
export const dynamic = "force-dynamic";
export default async function robots(): Promise<MetadataRoute.Robots> {
  const s = await shopSettings(),
    base = origin(s);
  if (s.demo || s.localBrochureOrdering || !base) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api",
        "/kolichka",
        "/porachka",
        "/prosledyavane",
        "/tarsene",
      ],
    },
    sitemap: base + "/sitemap.xml",
  };
}
