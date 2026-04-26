// GET /v1/platform/revenue — admin-secret protected.

import { platformRevenue } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const r = platformRevenue();
  return Response.json({
    ok: true,
    total_fee_sats: r.total_fee_sats,
    tx_count: r.tx_count,
    note: "Mock-mode counter only. Real-mode payout via PLATFORM_NWC_URL is deferred.",
  });
}
