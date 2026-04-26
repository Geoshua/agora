// L402 macaroon mint / verify primitives — MDK-shape (ADR 0014).
//
// The seller-side L402 wrapper is a thin shim around MoneyDevKit's
// public token format. Real mode (MOCK_MODE=false + MDK_ACCESS_TOKEN +
// MDK_MNEMONIC) defers to @moneydevkit/nextjs/server.withPayment for
// the provider; the plain-Node sellers (dataset-seller, market-monitor)
// re-implement the same wire format using these primitives.
//
// Mock mode (MOCK_MODE=true, the default) mints and verifies offline:
// the macaroon bytes are bit-for-bit MDK-compatible, but no network
// round-trip and no MDK account are required. Idempotency is enforced
// by the seller's existing SQLite invoices store.
//
// Wire format (MDK-shape):
//   base64(JSON({
//     paymentHash, amountSats, expiresAt, resource,
//     amount, currency, sig
//   }))
// where
//   sig = HMAC-SHA256(deriveL402Key(secret),
//                     paymentHash\0amountSats\0expiresAt\0
//                     resource\0amount\0currency).hex
// and resource is "<METHOD>:<path>" (e.g. "POST:/v1/listing-verify").
//
// Soft-transition (ADR 0014 §"Migration timeline"): verifyAuth tries
// MDK-shape first, falls back to the legacy `base64url(json).hmac`
// format on parse/sig failure. One major-version cycle from now the
// legacy verifier is removed.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// ─── public types ────────────────────────────────────────────────────

/** MDK-shape macaroon body, decoded. */
export type MacaroonBody = {
  /** Lightning payment_hash, 64-char hex. */
  payment_hash: string;
  /** "<METHOD>:<path>" canonical form, e.g. "POST:/v1/listing-verify". */
  resource: string;
  /** Amount in sats (or USD cents). */
  amount: number;
  /** Unix seconds. Reference only — we don't enforce it. */
  exp: number;
};

/** Currency tag — matches MDK's PaymentConfig.currency. */
export type L402Currency = "SAT" | "USD";

/** Inputs for minting an MDK-shape macaroon. */
export type MintMacaroonInput = {
  payment_hash: string;
  /** "<METHOD>:<path>" canonical form. */
  resource: string;
  amount: number;
  /** Unix seconds. */
  exp: number;
  /** Currency tag, default "SAT". */
  currency?: L402Currency;
};

/** Result of `verifyAuth`. */
export type AuthVerifyResult =
  | { ok: true; body: MacaroonBody; preimage: string; family: "mdk" | "legacy" }
  | { ok: false; reason: string };

export class L402SecretError extends Error {
  constructor() {
    super("L402_SECRET must be set and ≥32 chars");
    this.name = "L402SecretError";
  }
}

// ─── internal helpers ────────────────────────────────────────────────

const KEY_DERIVATION_TAG = "mdk402-token-v1";

function ensureSecret(secret: string | undefined): string {
  if (!secret || secret.length < 32) throw new L402SecretError();
  return secret;
}

function deriveKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_DERIVATION_TAG).digest();
}

function hmacSig(key: Buffer, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

/** Canonical resource form expected on the wire: "<METHOD>:<path>". */
export function canonicalResource(method: string, path: string): string {
  return `${method.toUpperCase()}:${path}`;
}

// ─── MDK-shape mint / verify ─────────────────────────────────────────

/**
 * Mint an MDK-shape macaroon.
 *
 * Caller is responsible for already having the bolt-11 invoice (real
 * or mock) — this only signs the credential. In real mode with a
 * Next.js provider, prefer `@moneydevkit/nextjs/server.withPayment`
 * instead, which mints the invoice AND credential in one call.
 *
 * Resource MUST already be in canonical "<METHOD>:<path>" form.
 */
export function mintMacaroon(input: MintMacaroonInput, secret: string): string {
  ensureSecret(secret);
  const currency: L402Currency = input.currency ?? "SAT";
  const key = deriveKey(secret);
  const message = [
    input.payment_hash,
    String(input.amount),
    String(input.exp),
    input.resource,
    String(input.amount),
    currency,
  ].join("\0");
  const sig = hmacSig(key, message);
  const tokenObj = {
    paymentHash: input.payment_hash,
    amountSats: input.amount,
    expiresAt: input.exp,
    resource: input.resource,
    amount: input.amount,
    currency,
    sig,
  };
  return Buffer.from(JSON.stringify(tokenObj)).toString("base64");
}

/**
 * Verify an MDK-shape macaroon (HMAC + format only — no preimage,
 * no expiry; MDK chose to make paid credentials permanent).
 *
 * Returns the decoded body in legacy snake_case for backward compat
 * with the rest of the codebase, or null on any failure.
 */
export function verifyMacaroon(macaroon: string, secret: string): MacaroonBody | null {
  ensureSecret(secret);
  try {
    const decoded = Buffer.from(macaroon, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as {
      paymentHash?: unknown;
      amountSats?: unknown;
      expiresAt?: unknown;
      resource?: unknown;
      amount?: unknown;
      currency?: unknown;
      sig?: unknown;
    };
    if (
      typeof parsed.paymentHash !== "string" ||
      typeof parsed.amountSats !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.resource !== "string" ||
      typeof parsed.amount !== "number" ||
      typeof parsed.currency !== "string" ||
      typeof parsed.sig !== "string"
    ) {
      return null;
    }
    if (!/^[0-9a-f]{64}$/.test(parsed.sig)) return null;

    const key = deriveKey(secret);
    const message = [
      parsed.paymentHash,
      String(parsed.amountSats),
      String(parsed.expiresAt),
      parsed.resource,
      String(parsed.amount),
      parsed.currency,
    ].join("\0");
    const expected = hmacSig(key, message);
    const a = Buffer.from(parsed.sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    return {
      payment_hash: parsed.paymentHash,
      resource: parsed.resource,
      amount: parsed.amount,
      exp: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

// ─── legacy verify (soft-transition compat) ──────────────────────────

/**
 * Verify a legacy-format macaroon: `base64url(json).hmac256(payload)`
 * — the format used pre-ADR 0014. Kept for one major-version cycle so
 * already-issued credentials still verify during the deprecation
 * window.
 *
 * Old format had snake_case JSON keys natively. Returns the body or null.
 */
export function verifyMacaroonLegacy(macaroon: string, secret: string): MacaroonBody | null {
  ensureSecret(secret);
  const dot = macaroon.indexOf(".");
  if (dot < 0) return null;
  const payload = macaroon.slice(0, dot);
  const sig = macaroon.slice(dot + 1);
  // Legacy mints used base64url-encoded payload + raw secret as HMAC
  // key. We don't need to be byte-compatible with all historical
  // payloads — only with what the legacy `mintMacaroon` would produce.
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as MacaroonBody;
    if (typeof body?.payment_hash !== "string" || typeof body?.resource !== "string") return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Mint a legacy-format macaroon. Exported only for tests that need to
 * synthesize a legacy credential to prove the soft-transition verifier
 * still parses it. Real callers should always use `mintMacaroon`.
 */
export function mintMacaroonLegacy(input: MintMacaroonInput, secret: string): string {
  ensureSecret(secret);
  const body = {
    payment_hash: input.payment_hash,
    resource: input.resource,
    amount: input.amount,
    exp: input.exp,
  };
  const json = JSON.stringify(body);
  const payload = Buffer.from(json).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

// ─── preimage + auth header helpers ──────────────────────────────────

/** SHA256(preimage_bytes) === payment_hash. */
export function verifyPreimage(preimageHex: string, expectedPaymentHashHex: string): boolean {
  if (preimageHex.length !== 64) return false;
  const preimageBuf = Buffer.from(preimageHex, "hex");
  if (preimageBuf.length !== 32) return false;
  const hash = createHash("sha256").update(preimageBuf).digest("hex");
  return hash === expectedPaymentHashHex;
}

/** WWW-Authenticate header per bLIP-26. */
export function challengeHeader(macaroon: string, invoice: string): string {
  return `L402 macaroon="${macaroon}", invoice="${invoice}"`;
}

/**
 * Parse `Authorization: L402 <macaroon>:<preimage>` (also accepts the
 * `LSAT` legacy scheme per bLIP-26 backwards compat — same as MDK).
 */
export function parseAuthHeader(authHeader: string | null): { macaroon: string; preimage: string } | null {
  if (!authHeader) return null;
  const lower = authHeader.toLowerCase();
  let prefixLen: number;
  if (lower.startsWith("l402 ")) prefixLen = 5;
  else if (lower.startsWith("lsat ")) prefixLen = 5;
  else return null;
  const token = authHeader.slice(prefixLen).trim();
  const sep = token.indexOf(":");
  if (sep < 0) return null;
  const macaroon = token.slice(0, sep);
  const preimage = token.slice(sep + 1);
  if (!macaroon || !preimage) return null;
  return { macaroon, preimage };
}

// ─── verifyAuth: soft-transition MDK + legacy ────────────────────────

/**
 * Full L402 Authorization-header verification.
 *
 * - Parses the header (L402 or LSAT scheme).
 * - Tries MDK-shape macaroon verification first.
 * - On parse/sig failure, falls back to the legacy
 *   `base64url(json).hmac` format (one-cycle deprecation window).
 * - Verifies SHA256(preimage) == payment_hash.
 * - Verifies the macaroon's resource matches the expected one.
 *
 * Caller is still responsible for:
 * - persistence-layer single-use enforcement (the `invoices` table);
 * - real-mode wallet settlement check.
 *
 * `expectedResource` MUST be in canonical `<METHOD>:<path>` form.
 */
export function verifyAuth(
  authHeader: string | null,
  expectedResource: string,
  secret: string,
): AuthVerifyResult {
  const parsed = parseAuthHeader(authHeader);
  if (!parsed) return { ok: false, reason: "missing or malformed L402 header" };

  // Try MDK-shape first.
  let body = verifyMacaroon(parsed.macaroon, secret);
  let family: "mdk" | "legacy" = "mdk";

  if (!body) {
    // Soft-transition fallback: verify the legacy format.
    body = verifyMacaroonLegacy(parsed.macaroon, secret);
    family = "legacy";
  }

  if (!body) return { ok: false, reason: "invalid or expired macaroon" };

  if (body.resource !== expectedResource) {
    return { ok: false, reason: "macaroon scoped to a different resource" };
  }

  if (!verifyPreimage(parsed.preimage, body.payment_hash)) {
    return { ok: false, reason: "preimage does not match payment_hash" };
  }

  return { ok: true, body, preimage: parsed.preimage, family };
}

/**
 * Convenience helper for callers that have METHOD + PATH separately.
 * Equivalent to `verifyAuth(header, canonicalResource(method, path), secret)`.
 */
export function verifyAuthFor(
  authHeader: string | null,
  method: string,
  path: string,
  secret: string,
): AuthVerifyResult {
  return verifyAuth(authHeader, canonicalResource(method, path), secret);
}
