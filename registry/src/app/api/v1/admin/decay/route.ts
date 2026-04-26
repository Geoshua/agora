// POST /v1/admin/decay — admin-secret-protected.
//
// Forces a decay run regardless of cooldown. Used by tests to
// fast-forward 90+ days. In production, decay runs lazily.

import { forceRunDecay, maybeRunDecay } from "@/lib/reviews";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const r = force ? forceRunDecay() : maybeRunDecay();
  return Response.json({ ok: true, ...r });
}
