import { cancelSubscription, getSubscription } from "@/lib/db";
import { trace, finalize } from "@/lib/log";
import { errorResponse } from "@/lib/errors";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = trace(req, `/v1/subscriptions/${id}/cancel`);
  if (!getSubscription(id)) {
    return finalize(ctx, errorResponse("not_found", "no such subscription", 404, ctx.request_id));
  }
  const r = cancelSubscription(id);
  if (!r) return finalize(ctx, errorResponse("conflict", "already cancelled or exhausted", 409, ctx.request_id));
  return finalize(ctx, Response.json({
    ok: true,
    subscription_id: id,
    refunded_sats: r.refunded_sats,
    status: "cancelled",
  }), 0);
}
