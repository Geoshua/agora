// ─────────────────────────────────────────────────────────────────────
//  L402 — pay-per-call paywall, MDK-shape (ADR 0014).
//
//    1. Server returns 402 with header:
//         WWW-Authenticate: L402 macaroon="<b64>", invoice="<bolt11>"
//    2. Client pays the invoice → gets back a preimage.
//    3. Client retries with header:
//         Authorization: L402 <macaroon>:<preimage>
//    4. Server verifies SHA256(preimage)===payment_hash AND macaroon
//       HMAC, and that the macaroon has not already been consumed.
//
//  Macaroon byte-format is now MDK-compatible (base64 of one JSON
//  object including the sig field — see packages/agora-core/src/l402.ts
//  and ADR 0014). Soft-transition: verifyAuth still parses legacy
//  base64url(json).hmac macaroons for one deprecation cycle.
//
//  Idempotency lives in the SQLite invoices table — single-use
//  enforced regardless of mode. The provider always owns its own
//  invoices table (this preserves principle #3: single source of
//  truth per concern).
//
//  Real-mode MDK integration (when MOCK_MODE=false AND
//  MDK_ACCESS_TOKEN + MDK_MNEMONIC are set) currently uses MDK's wire
//  format with this provider's mock wallet for invoice issuance. The
//  full @moneydevkit/nextjs/server.withPayment integration is the next
//  refinement step — it requires a live moneydevkit.com account and
//  is documented in ADR 0014 §"Migration timeline".
// ─────────────────────────────────────────────────────────────────────

import {
  mintMacaroon,
  verifyAuth as coreVerifyAuth,
  canonicalResource,
  challengeHeader,
  type AuthVerifyResult as CoreAuthVerifyResult,
  type MacaroonBody as CoreMacaroonBody,
} from "@agora/core";
import { wallet, type Invoice } from "./wallet";
import { recordInvoice, lookupInvoiceRow, markInvoiceConsumed } from "./db";
import { errorResponse } from "./errors";

const SECRET = () => {
  const s = process.env.L402_SECRET;
  if (!s || s.length < 32) throw new Error("L402_SECRET must be set and ≥32 chars");
  return s;
};

// Re-export the MacaroonBody shape for any consumer that imports it.
export type MacaroonBody = CoreMacaroonBody;

// ─── 402 response ────────────────────────────────────────────────────
/**
 * Issue a 402 challenge for `resource` (a path like "/v1/listing-verify"
 * — we canonicalize to "POST:<path>" internally per MDK convention).
 */
export async function require402(
  resource: string,
  amount: number,
  description: string,
  ttlSec: number,
  request_id: string,
): Promise<Response> {
  const inv: Invoice = await wallet().makeInvoice(amount, description, ttlSec);
  const canonicalRes = canonicalResource("POST", resource);
  const macaroon = mintMacaroon(
    {
      payment_hash: inv.payment_hash,
      resource: canonicalRes,
      amount,
      exp: inv.expires_at,
      currency: "SAT",
    },
    SECRET(),
  );

  // Persist for replay protection + analytics. We store the un-canonicalized
  // path in `resource` to match historical rows (it's just analytics —
  // verification re-canonicalizes from the request method+path).
  recordInvoice({
    payment_hash: inv.payment_hash,
    macaroon,
    resource,
    amount_sats: amount,
    created_at: Math.floor(Date.now() / 1000),
    expires_at: inv.expires_at,
  });

  return new Response(
    JSON.stringify({
      error: "payment_required",
      message: `${amount} sats required for ${resource}`,
      request_id,
      docs: "https://github.com/ouazmourad/lumen#errors",
      invoice: inv.invoice,
      payment_hash: inv.payment_hash,
      amount_sats: amount,
      expires_at: inv.expires_at,
      macaroon,
    }),
    {
      status: 402,
      headers: {
        "content-type": "application/json",
        "www-authenticate": challengeHeader(macaroon, inv.invoice),
        "x-lumen-resource": resource,
        "x-lumen-amount-sats": String(amount),
        "x-request-id": request_id,
      },
    },
  );
}

// ─── auth verification ───────────────────────────────────────────────
export type AuthResult =
  | { ok: true; body: MacaroonBody; preimage: string; family: "mdk" | "legacy" }
  | { ok: false; status: 401 | 409; code: "unauthorized" | "already_consumed"; reason: string };

export async function verifyAuth(authHeader: string | null, expectedResource: string): Promise<AuthResult> {
  // Map the historical resource path to MDK-canonical "<METHOD>:<path>".
  const canonicalRes = canonicalResource("POST", expectedResource);

  const r: CoreAuthVerifyResult = coreVerifyAuth(authHeader, canonicalRes, SECRET());
  if (!r.ok) {
    return { ok: false, status: 401, code: "unauthorized", reason: r.reason };
  }

  // (real mode) confirm the wallet sees the invoice as settled.
  if (wallet().kind === "real") {
    const lookup = await wallet().lookupInvoice(r.body.payment_hash);
    if (!lookup.paid) {
      return {
        ok: false,
        status: 401,
        code: "unauthorized",
        reason: "invoice not yet settled with the wallet",
      };
    }
  }

  // ─── single-use enforcement ─────────────────────────────────────
  // Atomic transition pending|paid -> consumed. If we can't, someone
  // already consumed this macaroon — reject as 409.
  const row = lookupInvoiceRow(r.body.payment_hash);
  if (row && row.status === "consumed")
    return { ok: false, status: 409, code: "already_consumed", reason: "macaroon already consumed" };

  const flipped = markInvoiceConsumed(r.body.payment_hash, r.preimage);
  if (!flipped) {
    // Either the row never existed (provider was restarted before
    // paying — rare) or another concurrent request beat us to it.
    return { ok: false, status: 409, code: "already_consumed", reason: "macaroon already consumed (race)" };
  }

  return { ok: true, body: r.body, preimage: r.preimage, family: r.family };
}

export function authError(result: Extract<AuthResult, { ok: false }>, request_id: string): Response {
  return errorResponse(result.code, result.reason, result.status, request_id);
}
