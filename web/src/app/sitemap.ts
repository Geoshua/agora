import type { MetadataRoute } from "next";
import { listSellers, listServices } from "@/lib/registry";

const BASE_URL = process.env.ANDROMEDA_WEB_URL ?? "http://localhost:3300";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [sellers, services] = await Promise.all([
    listSellers({ limit: 500 }),
    listServices({ limit: 500 }),
  ]);

  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    "",
    "/sellers",
    "/services",
    "/search",
    "/recommend",
  ].map((p) => ({ url: `${BASE_URL}${p}`, lastModified: now, priority: 0.8 }));

  const sellerPages: MetadataRoute.Sitemap = (sellers?.sellers ?? []).map(
    (s) => ({
      url: `${BASE_URL}/sellers/${s.pubkey}`,
      lastModified: new Date(s.last_active_at),
      priority: 0.6,
    })
  );

  const servicePages: MetadataRoute.Sitemap = (services?.services ?? []).map(
    (s) => ({
      url: `${BASE_URL}/services/${encodeURIComponent(s.id)}`,
      lastModified: new Date(s.updated_at),
      priority: 0.7,
    })
  );

  return [...staticPages, ...sellerPages, ...servicePages];
}
