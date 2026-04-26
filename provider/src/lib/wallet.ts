// ─────────────────────────────────────────────────────────────────────
//  Wallet adapter — fronts MOCK or real NWC, same surface either way.
//
//  • Real:  @getalby/sdk NWCClient via nostr+walletconnect://… URL.
//  • Mock:  in-process, bolt-11-shaped invoices, deterministic preimage.
//
//  Status (ADR 0014):
//    The seller-side L402 wire format moved to MoneyDevKit's macaroon
//    shape. In a future revision the provider will plug into MDK's
//    @moneydevkit/nextjs/server.withPayment helper for real-mode
//    invoice issuance — at that point the NWC code path here becomes
//    fully redundant and can be removed. We keep this file unchanged
//    today because:
//      1. mock mode (the default) still uses the mock branch as the
//         source of fake bolt-11 invoices and deterministic preimages;
//      2. the buyer-side `provider/api/dev/pay` endpoint reads the
//         `mockStore` via `mockPreimageFor` to satisfy the L402 replay;
//      3. no live MDK_ACCESS_TOKEN exists in CI / test gates, so the
//         provider continues to use this adapter for offline runs.
//    The full MDK-managed Lightning rail is documented in ADR 0014
//    §"Migration timeline".
// ─────────────────────────────────────────────────────────────────────

import { NWCClient } from "@getalby/sdk";
import { createHash, randomBytes } from "node:crypto";

export type Invoice = {
  invoice: string;       // bolt-11 (or fake-bolt-11 in mock mode)
  payment_hash: string;  // hex
  amount: number;        // sats
  description: string;
  expires_at: number;    // unix seconds
};

export type LookupResult = {
  paid: boolean;
  preimage?: string;     // hex, present if paid
};

export interface Wallet {
  kind: "real" | "mock";
  makeInvoice(amount: number, description: string, ttlSec: number): Promise<Invoice>;
  lookupInvoice(payment_hash: string): Promise<LookupResult>;
}

// ─── mock wallet ─────────────────────────────────────────────────────
const mockStore = new Map<string, { preimage: string; amount: number; description: string; expires_at: number }>();

const mock: Wallet = {
  kind: "mock",
  async makeInvoice(amount, description, ttlSec) {
    const preimage = randomBytes(32).toString("hex");
    const payment_hash = createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");
    const expires_at = Math.floor(Date.now() / 1000) + ttlSec;
    mockStore.set(payment_hash, { preimage, amount, description, expires_at });
    // fake bolt-11: keeps the wire format readable while clearly being a mock.
    const fake = `lnbcMOCK${amount}u1${payment_hash.slice(0, 40)}`;
    return { invoice: fake, payment_hash, amount, description, expires_at };
  },
  async lookupInvoice(payment_hash) {
    const rec = mockStore.get(payment_hash);
    if (!rec) return { paid: false };
    // mock mode: invoice is "paid" the moment someone presents the matching preimage.
    // we don't track payments here; the L402 verifier checks SHA256(preimage)===payment_hash directly.
    return { paid: true, preimage: rec.preimage };
  },
};

// expose preimage so the mock buyer can pretend to "pay" without a wallet.
export function mockPreimageFor(payment_hash: string): string | undefined {
  return mockStore.get(payment_hash)?.preimage;
}

// ─── real wallet (Alby NWC) ──────────────────────────────────────────
let nwc: NWCClient | null = null;
function nwcClient(): NWCClient {
  if (nwc) return nwc;
  const url = process.env.NWC_URL;
  if (!url) throw new Error("NWC_URL not set; cannot run in real mode");
  nwc = new NWCClient({ nostrWalletConnectUrl: url });
  return nwc;
}

const real: Wallet = {
  kind: "real",
  async makeInvoice(amount, description, ttlSec) {
    const tx = await nwcClient().makeInvoice({ amount: amount * 1000, description, expiry: ttlSec });
    return {
      invoice: tx.invoice,
      payment_hash: tx.payment_hash,
      amount,
      description,
      expires_at: tx.expires_at,
    };
  },
  async lookupInvoice(payment_hash) {
    const tx = await nwcClient().lookupInvoice({ payment_hash });
    return { paid: tx.state === "settled", preimage: tx.preimage };
  },
};

// ─── selector ────────────────────────────────────────────────────────
export function wallet(): Wallet {
  return process.env.MOCK_MODE === "true" ? mock : real;
}
