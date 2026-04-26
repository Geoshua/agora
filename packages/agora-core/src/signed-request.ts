// Signed HTTP requests for cross-service Agora calls.
//
// The signature canonicalizes:
//   <METHOD>\n<PATH>\n<sha256-of-body-hex-or-empty>\n<TIMESTAMP-ms>
//
// Every signed request carries (canonical, AGORA-prefixed):
//   X-Agora-Pubkey:    <hex Ed25519 pub>
//   X-Agora-Timestamp: <unix-ms>
//   X-Agora-Sig:       <hex Ed25519 sig>
//
// The verifier ALSO accepts the legacy header families:
//   X-Andromeda-* (ADR 0002 era)
//   X-Lumen-*     (pre-Andromeda)
// per ADR 0013. Outgoing requests only emit X-Agora-*.
//
// Verifier rejects timestamps older than DEFAULTS.SIGNATURE_VALIDITY_MS
// or further in the future than the same window (clock skew).

import { sha256 } from "@noble/hashes/sha2.js";
import { signUtf8, verifyUtf8, bytesToHex } from "./crypto.js";
import { DEFAULTS } from "./config.js";

// Canonical (AGORA) header names — what we emit on outgoing requests.
export const HDR_PUBKEY = "x-agora-pubkey";
export const HDR_TIMESTAMP = "x-agora-timestamp";
export const HDR_SIG = "x-agora-sig";

// Legacy header families we still accept on incoming requests.
// ADR 0002 era:
export const HDR_PUBKEY_ANDROMEDA = "x-andromeda-pubkey";
export const HDR_TIMESTAMP_ANDROMEDA = "x-andromeda-timestamp";
export const HDR_SIG_ANDROMEDA = "x-andromeda-sig";
// Pre-rebrand:
export const HDR_PUBKEY_LUMEN = "x-lumen-pubkey";
export const HDR_TIMESTAMP_LUMEN = "x-lumen-timestamp";
export const HDR_SIG_LUMEN = "x-lumen-sig";

/** Header families, in the order the verifier prefers them. */
const HEADER_FAMILIES: ReadonlyArray<{ pubkey: string; timestamp: string; sig: string; family: "agora" | "andromeda" | "lumen" }> = [
  { pubkey: HDR_PUBKEY, timestamp: HDR_TIMESTAMP, sig: HDR_SIG, family: "agora" },
  { pubkey: HDR_PUBKEY_ANDROMEDA, timestamp: HDR_TIMESTAMP_ANDROMEDA, sig: HDR_SIG_ANDROMEDA, family: "andromeda" },
  { pubkey: HDR_PUBKEY_LUMEN, timestamp: HDR_TIMESTAMP_LUMEN, sig: HDR_SIG_LUMEN, family: "lumen" },
];

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
 * the path includes it). Always emits X-Agora-* (canonical).
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
  | { ok: true; pubkey: string; timestamp: number; family: "agora" | "andromeda" | "lumen" }
  | { ok: false; reason: string };

/**
 * Verify a signed request. `headers` is a plain object of
 * lowercased-key strings; pass `req.headers` from Next.js / Express
 * after lowercasing.
 *
 * Tries the AGORA family first, then ANDROMEDA, then LUMEN. Returns the
 * first family for which all three headers are present (regardless of
 * whether its signature ultimately validates) so callers see clear
 * "signature invalid" / "timestamp outside window" errors instead of
 * the generic "missing signature headers".
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

  let chosen: typeof HEADER_FAMILIES[number] | null = null;
  for (const fam of HEADER_FAMILIES) {
    if (get(fam.pubkey) && get(fam.timestamp) && get(fam.sig)) {
      chosen = fam;
      break;
    }
  }
  if (!chosen) {
    return { ok: false, reason: "missing signature headers" };
  }

  const pubkey = get(chosen.pubkey)!;
  const tsRaw = get(chosen.timestamp)!;
  const sig = get(chosen.sig)!;

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
  return { ok: true, pubkey, timestamp: ts, family: chosen.family };
}

/** Helper: turn a Headers iterable into a plain lowercased map. */
export function headersToObject(h: Iterable<[string, string]> | Headers): Record<string, string> {
  const out: Record<string, string> = {};
  // node Headers and fetch Headers both iterate as [k,v]
  const it = (h as Headers).entries ? (h as Headers).entries() : (h as Iterable<[string, string]>);
  for (const [k, v] of it) out[k.toLowerCase()] = v;
  return out;
}
