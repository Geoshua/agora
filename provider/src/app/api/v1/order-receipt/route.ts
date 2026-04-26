// POST /v1/order-receipt   — paid · 120 sat
//   Issues a signed delivery receipt for an order. Persists it so the
//   buyer can re-fetch it later via GET /v1/receipts/{receipt_id}.

import { require402, verifyAuth, authError } from "@/lib/l402";
import { errorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";
import { trace, finalize } from "@/lib/log";
import { recordReceipt } from "@/lib/db";
import { recordTxFireAndForget } from "@/lib/registry-client";
import { createHash, createHmac } from "node:crypto";

const RESOURCE = "/v1/order-receipt";
const PRICE = 120;
const TTL = 300;

export async function POST(req: Request) {
  const ctx = trace(req, RESOURCE);

  const limited = rateLimit(req, ctx.request_id);
  if (limited) return finalize(ctx, limited);

  const auth = req.headers.get("authorization");
  if (!auth) {
    const r = await require402(RESOURCE, PRICE, "lumen.order-receipt", TTL, ctx.request_id);
    return finalize(ctx, r);
  }

  const result = await verifyAuth(auth, RESOURCE);
  if (!result.ok) return finalize(ctx, authError(result, ctx.request_id));

  let body: { order_id?: string; invoice?: string; buyer?: string; notes?: string };
  try { body = await req.json(); }
  catch { return finalize(ctx, errorResponse("bad_request", "invalid JSON", undefined, ctx.request_id)); }
  if (!body.order_id || !body.invoice)
    return finalize(ctx, errorResponse("bad_request", "order_id and invoice required", undefined, ctx.request_id));

  const parsed = parseBolt11Lite(body.invoice);
  const issued_at = new Date().toISOString();
  const receipt_id = `rcpt_${createHash("sha256").update(`${body.order_id}|${parsed.payment_hash}|${issued_at}`).digest("hex").slice(0, 24)}`;

  const claims = {
    receipt_id,
    issuer: "lumen.order-receipt",
    issued_at,
    order_id: body.order_id,
    invoice_payment_hash: parsed.payment_hash,
    amount_sats: parsed.amount_sats,
    network: parsed.network,
    buyer: body.buyer ?? null,
    notes: body.notes ?? null,
    fee_sats: PRICE,
    rev: "v0.1.0",
  };
  const claims_json = JSON.stringify(claims);
  const signature = createHmac("sha256", process.env.L402_SECRET!).update(claims_json).digest("base64url");

  recordReceipt({
    receipt_id, claims_json, signature, order_id: body.order_id, buyer: body.buyer ?? null,
  });

  recordTxFireAndForget({
    buyer_pubkey: req.headers.get("x-andromeda-pubkey"),
    service_local_id: "order-receipt",
    amount_sats: result.body.amount,
    payment_hash: result.body.payment_hash,
  });

  const res = Response.json({ ...claims, signature }, {
    headers: {
      "x-lumen-paid-sats": String(result.body.amount),
      "x-lumen-preimage": result.preimage.slice(0, 8) + "...",
      "x-lumen-receipt-id": receipt_id,
    },
  });
  return finalize(ctx, res, result.body.amount);
}

function parseBolt11Lite(invoice: string): { amount_sats: number | null; payment_hash: string; network: string } {
  const inv = invoice.trim().toLowerCase();
  let network = "unknown";
  if (inv.startsWith("lnbcmock")) network = "mock";
  else if (inv.startsWith("lnbcrt")) network = "regtest";
  else if (inv.startsWith("lntb")) network = "testnet";
  else if (inv.startsWith("lnsb")) network = "signet";
  else if (inv.startsWith("lnbc")) network = "mainnet";

  let amount_sats: number | null = null;
  const amt = inv.match(/^lnbc(?:mock|rt)?(\d+)([munp])?/);
  if (amt) {
    const n = parseInt(amt[1], 10);
    const mult = amt[2];
    const btc = mult === "m" ? n * 1e-3 : mult === "u" ? n * 1e-6 : mult === "n" ? n * 1e-9 : mult === "p" ? n * 1e-12 : n;
    amount_sats = Math.round(btc * 1e8);
  }

  const payment_hash = createHash("sha256").update(invoice).digest("hex");
  return { amount_sats, payment_hash, network };
}
