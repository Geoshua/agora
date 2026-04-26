import { getSubscription, topUpSubscription } from "@/lib/db";
import { trace, finalize } from "@/lib/log";
import { errorResponse } from "@/lib/errors";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = trace(req, `/v1/subscriptions/${id}/topup`);
  let body: { sats?: number };
  try { body = await req.json(); }
  catch { return finalize(ctx, errorResponse("bad_request", "invalid JSON", undefined, ctx.request_id)); }
  if (!body.sats || body.sats < 1 || !Number.isInteger(body.sats)) {
    return finalize(ctx, errorResponse("bad_request", "sats must be a positive integer", undefined, ctx.request_id));
  }
  if (!getSubscription(id)) {
    return finalize(ctx, errorResponse("not_found", "no such subscription", 404, ctx.request_id));
  }
  const ok = topUpSubscription(id, body.sats);
  if (!ok) return finalize(ctx, errorResponse("conflict", "subscription is cancelled", 409, ctx.request_id));
  const sub = getSubscription(id)!;
  return finalize(ctx, Response.json({
    ok: true,
    subscription_id: id,
    balance_sats: sub.balance_sats,
    status: sub.status,
  }), 0);
}
