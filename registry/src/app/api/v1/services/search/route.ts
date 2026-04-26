// GET /v1/services/search?q=...&max_price_sats=...

import { searchServices } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const maxStr = url.searchParams.get("max_price_sats");
  const max_price_sats = maxStr ? parseInt(maxStr, 10) : undefined;
  const type = url.searchParams.get("type") ?? undefined;

  let rows = searchServices(q, 30);
  if (max_price_sats !== undefined) rows = rows.filter(r => r.price_sats <= max_price_sats);
  if (type) rows = rows.filter(r => r.type === type);

  return Response.json({
    query: q,
    services: rows.map(r => ({
      id: r.id, seller_pubkey: r.seller_pubkey, local_id: r.local_id,
      name: r.name, description: r.description, type: r.type,
      tags: JSON.parse(r.tags_json), price_sats: r.price_sats,
      p50_ms: r.p50_ms, endpoint: r.endpoint,
    })),
    count: rows.length,
  });
}
