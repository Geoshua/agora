// GET /v1/sellers/:pubkey — single seller with their services and stats.

import { getSeller, listServices, sellerStats } from "@/lib/db";
import { sellerBadges, maybeRunDecay } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ pubkey: string }> }) {
  // Lazy daily decay (idempotent within 24h).
  try { maybeRunDecay(); } catch {}
  const { pubkey } = await params;
  const s = getSeller(pubkey);
  if (!s) return Response.json({ error: "no such seller" }, { status: 404 });
  const services = listServices({ seller_pubkey: pubkey, limit: 200 });
  const stats = sellerStats(pubkey);
  const badges = sellerBadges(pubkey);
  return Response.json({
    seller: {
      pubkey: s.pubkey, name: s.name, url: s.url, honor: s.honor,
      description: s.description,
      registered_at: new Date(s.registered_at).toISOString(),
      last_active_at: new Date(s.last_active_at).toISOString(),
      badges,
    },
    services: services.map(svc => ({
      id: svc.id, local_id: svc.local_id, name: svc.name, description: svc.description,
      type: svc.type, tags: JSON.parse(svc.tags_json), price_sats: svc.price_sats,
      p50_ms: svc.p50_ms, endpoint: svc.endpoint,
      updated_at: new Date(svc.updated_at).toISOString(),
    })),
    stats: {
      tx_count: stats.tx_count,
      sats_earned: stats.sats_earned,
    },
  });
}
