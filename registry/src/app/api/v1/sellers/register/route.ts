// POST /v1/sellers/register — signed by the seller (signing pubkey must
// match the registered pubkey).
// Body: { pubkey, name, url, description?, services?: [...] }

import { upsertSeller, upsertService } from "@/lib/db";
import { verifySignedRequest, readBody } from "@/lib/sig";

export const dynamic = "force-dynamic";

type RegisterBody = {
  pubkey: string;
  name: string;
  url: string;
  description?: string;
  services?: Array<{
    local_id: string;
    name: string;
    description: string;
    type: string;
    tags?: string[];
    price_sats: number;
    p50_ms?: number;
    endpoint: string;
  }>;
};

export async function POST(req: Request) {
  const { raw, json } = await readBody<RegisterBody>(req);
  const auth = await verifySignedRequest(req, raw);
  if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status });
  if (!json) return Response.json({ error: "invalid JSON body" }, { status: 400 });

  if (!json.pubkey || !json.name || !json.url) {
    return Response.json({ error: "pubkey, name, url required" }, { status: 400 });
  }
  if (json.pubkey !== auth.pubkey) {
    return Response.json({ error: "body pubkey must match signing pubkey" }, { status: 403 });
  }

  upsertSeller({ pubkey: json.pubkey, name: json.name, url: json.url, description: json.description });

  const serviceIds: string[] = [];
  if (Array.isArray(json.services)) {
    for (const s of json.services) {
      if (!s.local_id || !s.name || !s.description || !s.type || s.price_sats === undefined || !s.endpoint) {
        return Response.json({ error: `service ${s.local_id ?? "?"} missing required fields` }, { status: 400 });
      }
      const { id } = upsertService({
        seller_pubkey: json.pubkey,
        local_id: s.local_id,
        name: s.name,
        description: s.description,
        type: s.type,
        tags: s.tags ?? [],
        price_sats: s.price_sats,
        p50_ms: s.p50_ms,
        endpoint: s.endpoint,
      });
      serviceIds.push(id);
    }
  }

  return Response.json({ ok: true, pubkey: json.pubkey, services: serviceIds });
}
