// Signed HTTP requests for cross-service Andromeda calls.
//
// The signature canonicalizes:
//   <METHOD>\n<PATH>\n<sha256-of-body-hex-or-empty>\n<TIMESTAMP-ms>
//
// Every signed request carries:
//   X-Andromeda-Pubkey:    <hex Ed25519 pub>
//   X-Andromeda-Timestamp: <unix-ms>
//   X-Andromeda-Sig:       <hex Ed25519 sig>
//
// Verifier rejects timestamps older than DEFAULTS.SIGNATURE_VALIDITY_MS
// or further in the future than the same window (clock skew).

import { sha256 } from "@noble/hashes/sha2";
import { signUtf8, verifyUtf8, bytesToHex } from "./crypto.js";
import { DEFAULTS } from "./config.js";

export const HDR_PUBKEY = "x-andromeda-pubkey";
export const HDR_TIMESTAMP = "x-andromeda-timestamp";
export const HDR_SIG = "x-andromeda-sig";

export type SignedHeaders = {
  [HDR_PUBKEY]: string;
  [HDR_TIMESTAMP]: string;
  [HDR_SIG]: string;
};

function bodySha256Hex(body: string | undefined): string {
  if (!body || body.length === 0) return "";
  const bytes = new TextEncoder().encode(body);
  return bytesToHex(sha256(bytes));
}

function canonicalString(method: string, path: string, bodyShaHex: string, ts: number): string {
  return [method.toUpperCase(), path, bodyShaHex, String(ts)].join("\n");
}

/**
 * Build the three signed-request headers for a given outbound call.
 * `path` should be the request URL's pathname (no host, no query unless
 * the path includes it).
 */
export async function signRequest(opts: {
  method: string;
  path: string;
  body?: string;
  privkeyHex: string;
  pubkeyHex: string;
  timestampMs?: number;
}): Promise<SignedHeaders> {
  const ts = opts.timestampMs ?? Date.now();
  const bodySha = bodySha256Hex(opts.body);
  const msg = canonicalString(opts.method, opts.path, bodySha, ts);
  const sig = await signUtf8(msg, opts.privkeyHex);
  return {
    [HDR_PUBKEY]: opts.pubkeyHex,
    [HDR_TIMESTAMP]: String(ts),
    [HDR_SIG]: sig,
  };
}

export type VerifyResult =
  | { ok: true; pubkey: string; timestamp: number }
  | { ok: false; reason: string };

/**
 * Verify a signed request. `headers` is a plain object of
 * lowercased-key strings; pass `req.headers` from Next.js / Express
 * after lowercasing.
 */
export async function verifyRequest(opts: {
  method: string;
  path: string;
  body?: string;
  headers: Record<string, string | string[] | undefined>;
  validityMs?: number;
  nowMs?: number;
}): Promise<VerifyResult> {
  const get = (k: string): string | undefined => {
    const v = opts.headers[k] ?? opts.headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const pubkey = get(HDR_PUBKEY);
  const tsRaw = get(HDR_TIMESTAMP);
  const sig = get(HDR_SIG);
  if (!pubkey || !tsRaw || !sig) {
    return { ok: false, reason: "missing signature headers" };
  }
  const ts = parseInt(tsRaw, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "invalid timestamp" };
  }
  const now = opts.nowMs ?? Date.now();
  const window = opts.validityMs ?? DEFAULTS.SIGNATURE_VALIDITY_MS;
  if (Math.abs(now - ts) > window) {
    return { ok: false, reason: "timestamp outside ±5min window" };
  }
  const bodySha = bodySha256Hex(opts.body);
  const msg = canonicalString(opts.method, opts.path, bodySha, ts);
  const ok = await verifyUtf8(msg, sig, pubkey);
  if (!ok) return { ok: false, reason: "signature invalid" };
  return { ok: true, pubkey, timestamp: ts };
}

/** Helper: turn a Headers iterable into a plain lowercased map. */
export function headersToObject(h: Iterable<[string, string]> | Headers): Record<string, string> {
  const out: Record<string, string> = {};
  // node Headers and fetch Headers both iterate as [k,v]
  const it = (h as Headers).entries ? (h as Headers).entries() : (h as Iterable<[string, string]>);
  for (const [k, v] of it) out[k.toLowerCase()] = v;
  return out;
}
