// POST /v1/reviews/:id/dispute — buyer-signed
// body: { reason, evidence: {...} }
//
// Triggers slashing of the reviewer if the dispute carries verifiable
// evidence. Phase 5 v0: trust the dispute (a real implementation would
// run silent re-review here).

import { slashReviewer } from "@/lib/reviews";
import { verifySignedRequest, readBody } from "@/lib/sig";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Body = {
  reason?: string;
  evidence?: Record<string, unknown>;
};

const SIGNING_SECRET = process.env.ANDROMEDA_REGISTRY_SECRET ?? process.env.L402_SECRET ?? "registry-default-secret-please-set-something-stronger";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { raw, json } = await readBody<Body>(req);
  const auth = await verifySignedRequest(req, raw);
  if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status });
  if (!json?.reason) return Response.json({ error: "reason required" }, { status: 400 });

  const review = db().prepare(`SELECT id, reviewer_pubkey, request_id FROM reviews WHERE id = ?`).get(id) as
    { id: string; reviewer_pubkey: string; request_id: string } | undefined;
  if (!review) return Response.json({ error: "no such review" }, { status: 404 });

  const r = slashReviewer({
    request_id: review.request_id,
    reviewer_pubkey: review.reviewer_pubkey,
    reason: json.reason,
    evidence: json.evidence ?? {},
    signing_secret: SIGNING_SECRET,
  });
  if (!r.ok) return Response.json({ error: r.reason }, { status: 409 });
  return Response.json({ ok: true, ...r });
}
