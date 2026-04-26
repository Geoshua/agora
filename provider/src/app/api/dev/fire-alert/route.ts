// MOCK-ONLY: POST /api/dev/fire-alert
//   body: { subscription_id, kind, payload }
//
// Inserts an alert into a subscription, debiting balance per the
// usual rules. Used by the Phase 2 test gate to simulate the watcher
// loop without external HTTP fetches.

import { debitAndAlert } from "@/lib/db";
import { trace, finalize } from "@/lib/log";
import { errorResponse } from "@/lib/errors";
import { createHmac } from "node:crypto";

export async function POST(req: Request) {
  if (process.env.MOCK_MODE !== "true") {
    return Response.json({ error: "dev endpoint disabled in real mode" }, { status: 404 });
  }
  const ctx = trace(req, "/dev/fire-alert");
  let body: { subscription_id?: string; kind?: string; payload?: Record<string, unknown> };
  try { body = await req.json(); }
  catch { return finalize(ctx, errorResponse("bad_request", "invalid JSON", undefined, ctx.request_id)); }
  if (!body.subscription_id || !body.kind) {
    return finalize(ctx, errorResponse("bad_request", "subscription_id and kind required", undefined, ctx.request_id));
  }
  const payload = body.payload ?? {};
  const sig = createHmac("sha256", process.env.L402_SECRET!)
    .update(JSON.stringify({ kind: body.kind, payload }))
    .digest("base64url");
  const r = debitAndAlert({
    subscription_id: body.subscription_id,
    kind: body.kind,
    payload,
    signature: sig,
  });
  return finalize(ctx, Response.json(r), 0);
}
