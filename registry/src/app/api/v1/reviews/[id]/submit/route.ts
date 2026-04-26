// POST /v1/reviews/:id/submit — reviewer-signed
// body: { scores: {field→0..5}, justifications: {field→string} }

import { submitReview } from "@/lib/reviews";
import { verifySignedRequest, readBody } from "@/lib/sig";
import { validateReviewSubmission, rollupScore } from "@andromeda/core";
import type { ReviewRubricField } from "@andromeda/core";

export const dynamic = "force-dynamic";

type Body = {
  scores?: Record<string, number>;
  justifications?: Record<string, string>;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { raw, json } = await readBody<Body>(req);
  const auth = await verifySignedRequest(req, raw);
  if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status });
  if (!json || !json.scores) return Response.json({ error: "scores required" }, { status: 400 });

  const sub = {
    scores: json.scores as Record<ReviewRubricField, number>,
    justifications: json.justifications ?? {},
  };
  const errs = validateReviewSubmission(sub);
  if (errs.length > 0) return Response.json({ error: "invalid submission", details: errs }, { status: 400 });

  const rollup = rollupScore(sub.scores);
  const r = submitReview({
    request_id: id,
    reviewer_pubkey: auth.pubkey,
    scores: json.scores,
    justifications: json.justifications ?? {},
    rollup,
  });
  if (!r.ok) return Response.json({ error: r.reason }, { status: 409 });
  return Response.json({
    ok: true,
    review_id: r.review_id,
    rollup,
    reviewer_payout_sats: r.reviewer_payout_sats,
    platform_cut_sats: r.platform_cut_sats,
    new_seller_honor: r.new_honor,
  });
}
