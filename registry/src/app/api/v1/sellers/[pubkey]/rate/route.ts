// POST /v1/sellers/:pubkey/rate — buyer-signed
// body: { stars }

import { rateSeller } from "@/lib/reviews";
import { verifySignedRequest, readBody } from "@/lib/sig";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey } = await params;
  const { raw, json } = await readBody<{ stars?: number }>(req);
  const auth = await verifySignedRequest(req, raw);
  if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status });
  if (!json || typeof json.stars !== "number") {
    return Response.json({ error: "stars required" }, { status: 400 });
  }
  const r = rateSeller({ buyer_pubkey: auth.pubkey, seller_pubkey: pubkey, stars: json.stars });
  if (!r.ok) return Response.json({ error: r.reason }, { status: 403 });
  return Response.json({ ok: true, new_honor: r.new_honor });
}
