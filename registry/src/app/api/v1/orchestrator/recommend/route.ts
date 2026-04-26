// POST /v1/orchestrator/recommend
//   body: { intent, max_price_sats?, min_honor?, type? }
//
// Ranks services against the intent using cosine(embedding, query) +
// honor + price-fit. Each result includes the per-factor breakdown
// for explainability.

import { listServices, getSeller, setServiceEmbedding } from "@/lib/db";
import { embed, cosine, fromBlob, toBlob } from "@/lib/embeddings";
import { db, registerEmbeddingHook } from "@/lib/db";

export const dynamic = "force-dynamic";

// One-time wire-up: register the embedding hook so future upserts
// populate embedding_blob automatically.
registerEmbeddingHook((id, name, desc, tags) => {
  const text = [name, desc, (tags ?? []).join(" ")].join("\n");
  const v = embed(text);
  setServiceEmbedding(id, toBlob(v));
});

type Body = {
  intent: string;
  max_price_sats?: number;
  min_honor?: number;
  type?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try { body = await req.json(); }
  catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body.intent || typeof body.intent !== "string" || body.intent.length < 2) {
    return Response.json({ error: "intent (string ≥2 chars) required" }, { status: 400 });
  }

  // Backfill embeddings for any services without one.
  const all = listServices({ limit: 500 });
  for (const s of all) {
    const row = db().prepare(`SELECT embedding_blob FROM services WHERE id = ?`).get(s.id) as { embedding_blob: Buffer | null } | undefined;
    if (!row?.embedding_blob) {
      const v = embed([s.name, s.description, JSON.parse(s.tags_json).join(" ")].join("\n"));
      setServiceEmbedding(s.id, toBlob(v));
    }
  }

  const queryVec = embed(body.intent);

  // Compute max honor for normalization.
  const honors = (db().prepare(`SELECT honor FROM sellers`).all() as { honor: number }[]).map(r => r.honor);
  const maxHonor = Math.max(1, ...honors);

  type Scored = {
    service_id: string; seller_pubkey: string; local_id: string;
    name: string; description: string; type: string; price_sats: number;
    honor: number;
    intent_match: number; honor_normalized: number; price_fit: number;
    score: number;
    endpoint: string;
  };
  const scored: Scored[] = [];
  const excluded: Array<{ service_id: string; reason: string }> = [];

  for (const s of all) {
    const row = db().prepare(`SELECT embedding_blob FROM services WHERE id = ?`).get(s.id) as { embedding_blob: Buffer | null } | undefined;
    if (!row?.embedding_blob) continue;

    if (body.max_price_sats !== undefined && s.price_sats > body.max_price_sats) {
      excluded.push({ service_id: s.id, reason: "no service within price" });
      continue;
    }
    if (body.type && s.type !== body.type) continue;

    const seller = getSeller(s.seller_pubkey);
    const honor = seller?.honor ?? 0;
    if (body.min_honor !== undefined && honor < body.min_honor) {
      excluded.push({ service_id: s.id, reason: `honor below min (${honor} < ${body.min_honor})` });
      continue;
    }

    const sVec = fromBlob(row.embedding_blob);
    const intent_match = Math.max(0, Math.min(1, cosine(queryVec, sVec)));
    const honor_normalized = Math.max(0, Math.min(1, honor / maxHonor));
    const price_fit = body.max_price_sats !== undefined
      ? 1
      : Math.max(0, 1 - Math.min(1, s.price_sats / 1000));
    const score = 0.6 * intent_match + 0.2 * honor_normalized + 0.2 * price_fit;

    scored.push({
      service_id: s.id, seller_pubkey: s.seller_pubkey, local_id: s.local_id,
      name: s.name, description: s.description, type: s.type, price_sats: s.price_sats,
      honor, intent_match, honor_normalized, price_fit, score,
      endpoint: s.endpoint,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  return Response.json({
    intent: body.intent,
    filter: {
      max_price_sats: body.max_price_sats ?? null,
      min_honor: body.min_honor ?? null,
      type: body.type ?? null,
    },
    weights: { intent_match: 0.6, honor_normalized: 0.2, price_fit: 0.2 },
    results: scored.slice(0, 20),
    excluded,
  });
}
