// POST /v1/admin/decay — admin-secret-protected.
//
// Forces a decay run regardless of cooldown. Used by tests to
// fast-forward 90+ days. In production, decay runs lazily.

import { forceRunDecay, maybeRunDecay } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const secret = req.headers.get("x-admin-secret") ?? "";
  const expected = process.env.ADMIN_SECRET ?? "dev-admin-secret";
  if (secret !== expected) return Response.json({ error: "unauthorized" }, { status: 401 });
  const r = force ? forceRunDecay() : maybeRunDecay();
  return Response.json({ ok: true, ...r });
}
