// POST /v1/reviewers/availability — reviewer-signed
// body: { available: boolean }

import { setReviewerAvailability } from "@/lib/reviews";
import { verifySignedRequest, readBody } from "@/lib/sig";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { raw, json } = await readBody<{ available?: boolean }>(req);
  const auth = await verifySignedRequest(req, raw);
  if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status });
  if (!json || typeof json.available !== "boolean") {
    return Response.json({ error: "available (boolean) required" }, { status: 400 });
  }
  setReviewerAvailability(auth.pubkey, json.available);
  return Response.json({ ok: true, pubkey: auth.pubkey, available: json.available });
}
