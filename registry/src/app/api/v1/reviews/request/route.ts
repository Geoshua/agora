// POST /v1/reviews/request — seller-signed
// body: { service_id?, escrow_sats }

import { requestReview } from "@/lib/reviews";
import { verifySignedRequest, readBody } from "@/lib/sig";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { raw, json } = await readBody<{ service_id?: string; escrow_sats?: number }>(req);
  const auth = await verifySignedRequest(req, raw);
  if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status });
  if (!json || typeof json.escrow_sats !== "number" || json.escrow_sats < 1) {
    return Response.json({ error: "escrow_sats (positive int) required" }, { status: 400 });
  }
  const r = requestReview({
    requester_pubkey: auth.pubkey,
    service_id: json.service_id,
    escrow_sats: json.escrow_sats,
  });
  if (!r.ok) return Response.json({ error: r.reason }, { status: 409 });
  return Response.json({
    ok: true,
    request_id: r.request_id,
    reviewer_pubkey: r.reviewer_pubkey,
    escrow_sats: json.escrow_sats,
    deadline_hours: 72,
  });
}
