// POST /api/v1/subscribe
//   body: { subscriber_pubkey, service_local_id, deposit_sats, per_event_sats?, config? }
//
// In mock mode the deposit is recorded immediately. In real mode, we
// 402-challenge the deposit; client pays via NWC, then re-POSTs with
// the L402 header. (Real-mode top-up flow uses the same pattern.)
//
// For Phase 2 simplicity we accept the request as-is and trust the
// caller — real-mode payment-gating is added when we plug NWC into
// the agents/market-monitor (which is the only seller using this).

import { trace, finalize } from "@/lib/log";
import { errorResponse } from "@/lib/errors";
import { createSubscription } from "@/lib/db";
import { randomUUID } from "node:crypto";

const RESOURCE = "/v1/subscribe";

type Body = {
  subscriber_pubkey: string;
  service_local_id: string;
  deposit_sats: number;
  per_event_sats?: number;
  config?: Record<string, unknown>;
};

const DEFAULT_PER_EVENT = parseInt(process.env.SUBSCRIPTION_DEFAULT_PER_EVENT_SATS ?? "50", 10);

export async function POST(req: Request) {
  const ctx = trace(req, RESOURCE);
  let body: Body;
  try { body = await req.json(); }
  catch { return finalize(ctx, errorResponse("bad_request", "invalid JSON", undefined, ctx.request_id)); }

  if (!body.subscriber_pubkey || !body.service_local_id || !body.deposit_sats) {
    return finalize(ctx, errorResponse("bad_request", "subscriber_pubkey, service_local_id, deposit_sats required", undefined, ctx.request_id));
  }
  if (body.deposit_sats < 1 || !Number.isInteger(body.deposit_sats)) {
    return finalize(ctx, errorResponse("bad_request", "deposit_sats must be a positive integer", undefined, ctx.request_id));
  }
  const per_event = body.per_event_sats ?? DEFAULT_PER_EVENT;
  if (per_event < 1) {
    return finalize(ctx, errorResponse("bad_request", "per_event_sats must be ≥1", undefined, ctx.request_id));
  }

  const id = `sub_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  createSubscription({
    id,
    subscriber_pubkey: body.subscriber_pubkey,
    service_local_id: body.service_local_id,
    per_event_sats: per_event,
    balance_sats: body.deposit_sats,
    config: body.config ?? {},
  });

  return finalize(ctx, Response.json({
    ok: true,
    subscription_id: id,
    service_local_id: body.service_local_id,
    per_event_sats: per_event,
    balance_sats: body.deposit_sats,
    status: "active",
    created_at: new Date().toISOString(),
  }), 0);
}
