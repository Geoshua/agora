// POST /v1/admin/fast-forward — admin-only
// body: { sellers_inactive_days: number }
//
// Test helper: backdates every seller's last_active_at by N days so
// the decay job's 90-day cutoff applies.

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  let body: { sellers_inactive_days?: number };
  try { body = await req.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const days = body.sellers_inactive_days ?? 0;
  if (days < 0) return Response.json({ error: "days must be non-negative" }, { status: 400 });
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const r = db().prepare(`UPDATE sellers SET last_active_at = ? WHERE last_active_at > ?`).run(cutoff, cutoff);
  return Response.json({ ok: true, sellers_backdated: r.changes, new_last_active_at: cutoff });
}
