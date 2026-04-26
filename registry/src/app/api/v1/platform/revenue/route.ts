// GET /v1/platform/revenue — admin-secret protected.

import { platformRevenue } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = req.headers.get("x-admin-secret") ?? "";
  const expected = process.env.ADMIN_SECRET ?? "dev-admin-secret";
  if (secret !== expected) return Response.json({ error: "unauthorized" }, { status: 401 });
  const r = platformRevenue();
  return Response.json({
    ok: true,
    total_fee_sats: r.total_fee_sats,
    tx_count: r.tx_count,
    note: "Mock-mode counter only. Real-mode payout via PLATFORM_NWC_URL is deferred.",
  });
}
