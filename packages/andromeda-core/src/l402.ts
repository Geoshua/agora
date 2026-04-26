// L402 macaroon mint / verify primitives — extracted from
// provider/src/lib/l402.ts so any Andromeda seller agent can mint
// macaroons in the same format.
//
// The HMAC format is FROZEN: base64url(json).hmac256.
// Provider continues to import its own copy unchanged; this module is
// for new seller agents (market-monitor, dataset-seller, ...).
//
// Each provider has its OWN secret. Macaroons minted by one provider
// only verify against that provider's secret. The format is shared;
// the secrets are not.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type MacaroonBody = {
  payment_hash: string;
  resource: string;
  amount: number;
  exp: number;
};

export class L402SecretError extends Error {
  constructor() {
    super("L402_SECRET must be set and ≥32 chars");
    this.name = "L402SecretError";
  }
}

function ensureSecret(secret: string | undefined): string {
  if (!secret || secret.length < 32) throw new L402SecretError();
  return secret;
}

/** Mint a macaroon. Format: `base64url(json).hmac` — unchanged from v0.1. */
export function mintMacaroon(body: MacaroonBody, secret: string): string {
  ensureSecret(secret);
  const json = JSON.stringify(body);
  const payload = Buffer.from(json).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify a macaroon. Returns the body on success, or null. */
export function verifyMacaroon(macaroon: string, secret: string): MacaroonBody | null {
  ensureSecret(secret);
  const [payload, sig] = macaroon.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as MacaroonBody;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

/** SHA256(preimage) === payment_hash. */
export function verifyPreimage(preimageHex: string, expectedPaymentHashHex: string): boolean {
  if (preimageHex.length !== 64) return false;
  const preimageBuf = Buffer.from(preimageHex, "hex");
  if (preimageBuf.length !== 32) return false;
  const hash = createHash("sha256").update(preimageBuf).digest("hex");
  return hash === expectedPaymentHashHex;
}

/** Build the WWW-Authenticate header value. */
export function challengeHeader(macaroon: string, invoice: string): string {
  return `L402 macaroon="${macaroon}", invoice="${invoice}"`;
}

/** Parse the Authorization: L402 <macaroon>:<preimage> header. */
export function parseAuthHeader(authHeader: string | null): { macaroon: string; preimage: string } | null {
  if (!authHeader || !authHeader.startsWith("L402 ")) return null;
  const token = authHeader.slice(5).trim();
  const sep = token.indexOf(":");
  if (sep < 0) return null;
  return { macaroon: token.slice(0, sep), preimage: token.slice(sep + 1) };
}
