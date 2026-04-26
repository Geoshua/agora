// GET /v1/services — filterable.

import { listServices } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? undefined;
  const tag = url.searchParams.get("tag") ?? undefined;
  const maxStr = url.searchParams.get("max_price_sats");
  const max_price_sats = maxStr ? parseInt(maxStr, 10) : undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const rows = listServices({ type, tag, max_price_sats, limit, offset });
  return Response.json({
    services: rows.map(r => ({
      id: r.id, seller_pubkey: r.seller_pubkey, local_id: r.local_id,
      name: r.name, description: r.description, type: r.type,
      tags: JSON.parse(r.tags_json), price_sats: r.price_sats,
      p50_ms: r.p50_ms, endpoint: r.endpoint,
      updated_at: new Date(r.updated_at).toISOString(),
    })),
    count: rows.length,
    filter: { type, tag, max_price_sats, limit, offset },
  });
}
