// ─────────────────────────────────────────────────────────────────────
//  Thin LUMEN HTTP client used by the MCP server.
//
//  Owns one shared LNClient (Alby NWC) for the session.  Every paid
//  tool calls callPaidEndpoint(path, args) — does the 402, parses the
//  challenge, runs a *budget reservation*, pays via Lightning, and
//  replays with the L402 header.
//
//  This is deliberately a small port of buyer/lumen.js.  We don't
//  reach into the buyer/ folder so the MCP package is self-contained
//  and installable on its own.
// ─────────────────────────────────────────────────────────────────────

import "dotenv/config";
import { LNClient } from "@getalby/sdk";
import { reserve, confirm } from "./budget.js";
import { tryBuyerIdentity } from "./identity.js";
import { appendTransaction } from "./transactions-log.js";

// New env name first, legacy fallback per ADR 0002.
export const PROVIDER =
  process.env.ANDROMEDA_PROVIDER_URL ??
  process.env.LUMEN_PROVIDER_URL ??
  process.env.PROVIDER_URL ??
  "http://localhost:3000";
export const REGISTRY = process.env.ANDROMEDA_REGISTRY_URL ?? "http://localhost:3030";
export const MOCK = process.env.MOCK_MODE === "true";
export const MAX_PRICE_SATS = parseInt(process.env.MAX_PRICE_SATS ?? "4000", 10);

let _ln = null;
function ln() {
  if (_ln) return _ln;
  if (MOCK) return null;
  if (!process.env.NWC_URL) throw new Error("NWC_URL not set; either set MOCK_MODE=true or paste a NWC connection string");
  _ln = new LNClient(process.env.NWC_URL);
  return _ln;
}
export function close() { try { _ln?.close(); _ln = null; } catch {} }

// ─── 402 → policy → pay → replay ──────────────────────────────────────
export async function callPaidEndpoint(path, args) {
  const t0 = Date.now();

  // Optional buyer pubkey header — lets the provider record an
  // attributable transaction in the registry. Not strictly required
  // (anonymous buyers still work).
  const id = tryBuyerIdentity();
  const buyerHeader = id ? { "x-andromeda-pubkey": id.pubkey } : {};

  const r = await fetch(`${PROVIDER}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...buyerHeader },
    body: JSON.stringify(args),
  });
  if (r.status !== 402) {
    const text = await r.text();
    throw new Error(`expected 402, got ${r.status}: ${text.slice(0, 200)}`);
  }
  const challenge = await r.json();

  // ── per-call cap ───────────────────────────────────────────────────
  if (challenge.amount_sats > MAX_PRICE_SATS) {
    throw new Error(`refused: invoice price ${challenge.amount_sats} sat exceeds MAX_PRICE_SATS ${MAX_PRICE_SATS}`);
  }
  // ── budget cap ─────────────────────────────────────────────────────
  const reason = reserve(challenge.amount_sats);
  if (reason) throw new Error(`refused: ${reason}`);

  // ── pay ────────────────────────────────────────────────────────────
  const { preimage, fees_paid } = await pay(challenge);
  confirm(challenge.amount_sats);

  // ── replay ─────────────────────────────────────────────────────────
  const r2 = await fetch(`${PROVIDER}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `L402 ${challenge.macaroon}:${preimage}`,
      ...buyerHeader,
    },
    body: JSON.stringify(args),
  });
  if (!r2.ok) {
    const text = await r2.text();
    throw new Error(`replay ${r2.status}: ${text.slice(0, 200)}`);
  }
  const body = await r2.json();

  // ── local transaction log (best-effort; used by dashboard) ─────────
  try {
    appendTransaction({
      kind: path.includes("listing-verify") ? "verify" : path.includes("order-receipt") ? "receipt" : "other",
      amount_sats: challenge.amount_sats,
      service: path,
      seller_pubkey: body?.seller_pubkey ?? null,
      seller_name: body?.seller_name ?? null,
      provider_url: PROVIDER,
      payment_hash: challenge.payment_hash,
    });
  } catch {}

  return {
    ok: true,
    spent_sats:  challenge.amount_sats,
    fees_paid,
    preimage,
    paid_invoice: challenge.invoice,
    payment_hash: challenge.payment_hash,
    elapsed_ms:  Date.now() - t0,
    body,
  };
}

// ─── pay: dispatches to mock or real ──────────────────────────────────
async function pay(challenge) {
  if (MOCK) {
    const r = await fetch(`${PROVIDER}/api/dev/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_hash: challenge.payment_hash }),
    });
    if (!r.ok) throw new Error(`mock pay failed: ${r.status}`);
    const j = await r.json();
    return { preimage: j.preimage, fees_paid: 0 };
  }
  const res = await ln().pay(challenge.invoice);
  return { preimage: res.preimage, fees_paid: res.fees_paid ?? 0 };
}

// ─── free helpers ────────────────────────────────────────────────────
export async function discover() {
  const r = await fetch(`${PROVIDER}/api/v1/discovery`);
  if (!r.ok) throw new Error(`discovery ${r.status}`);
  return r.json();
}

export async function fetchReceipt(id) {
  const r = await fetch(`${PROVIDER}/api/v1/receipts/${encodeURIComponent(id)}`);
  if (r.status === 404) throw new Error(`no such receipt: ${id}`);
  if (!r.ok) throw new Error(`receipt fetch ${r.status}`);
  return r.json();
}

export async function balance() {
  if (MOCK) return { mode: "mock", balance_sats: null };
  try {
    const c = ln();
    const b = await c.nwcClient.getBalance();
    return { mode: "real", balance_sats: Math.round((b.balance ?? 0) / 1000) };
  } catch (e) {
    return { mode: "real", balance_sats: null, error: e.message };
  }
}

export async function health() {
  const r = await fetch(`${PROVIDER}/api/health`);
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}
