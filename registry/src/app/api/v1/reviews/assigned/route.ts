// GET /v1/reviews/assigned?reviewer_pubkey=... — public read

import { getReviewerAssignments } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pubkey = url.searchParams.get("reviewer_pubkey");
  if (!pubkey) return Response.json({ error: "reviewer_pubkey query required" }, { status: 400 });
  const rows = getReviewerAssignments(pubkey);
  return Response.json({ reviewer_pubkey: pubkey, assigned: rows });
}
