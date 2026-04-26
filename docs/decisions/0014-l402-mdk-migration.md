# ADR 0014 — Migrate L402 macaroons to MoneyDevKit (MDK) wire format, with offline-shim for mock mode

Status: Accepted
Date: 2026-04-26

## Context

The SPIRAL × Hack-Nation brief favours integration with **MoneyDevKit
(MDK)** — a SPIRAL product — for the Lightning paywall layer. Until
this ADR, Agora's seller-side L402 was a hand-rolled HMAC primitive in
`provider/src/lib/l402.ts` (also re-exported from
`packages/agora-core/src/l402.ts` for the multi-seller agents). The
buyer side is unchanged: `@getalby/sdk`'s `LNClient.pay(invoice)` over
NWC.

The user's brief was explicit:
- **Seller side:** migrate to MDK as fully as practical. If MDK creates
  invoices (i.e. owns wallet integration), accept that.
- **Buyer side:** stays on `@getalby/sdk` NWC. The wire protocol
  (`Authorization: L402 <macaroon>:<preimage>`) is what the MCP server
  speaks — both ends keep speaking it; only the macaroon FORMAT changes.
- **Mock mode is non-negotiable.** If MDK has a sandbox/test mode,
  use it. If not, build a thin offline shim that produces MDK-shape
  macaroons.

## Recon (concrete findings)

Source consulted: `npm pack` of `@moneydevkit/nextjs@0.16.0`,
`@moneydevkit/core@0.16.0`, `@moneydevkit/lightning-js@0.1.81`,
`@moneydevkit/api-contract@0.1.24`. Primary references:
`@moneydevkit/core/dist/mdk402/with-payment.js`,
`@moneydevkit/core/dist/mdk402/token.js`,
`@moneydevkit/core/dist/mdk.js`,
`@moneydevkit/core/dist/preview.js`.

### MDK's L402 API surface

**Public exports** (`@moneydevkit/nextjs/server`):
```ts
import { withPayment, withDeferredSettlement } from '@moneydevkit/nextjs/server'
import type { PaymentConfig, SettleResult } from '@moneydevkit/nextjs/server'
import { POST, GET } from '@moneydevkit/nextjs/server/route'
```
- `withPayment(config: PaymentConfig, handler: Handler): Handler` —
  Web Fetch API wrapper. The handler signature is
  `(req: Request, context?: any) => Response | Promise<Response>`.
  Unauthenticated requests get a 402 with a real bolt-11 invoice
  minted on MDK's hosted node; on retry with a valid
  `Authorization: L402 <macaroon>:<preimage>`, the inner handler
  runs.
- `withDeferredSettlement(config, handler)` — same, but the handler
  receives a `settle()` callback and the credential is only redeemed
  after `settle()` is called. Useful when delivery may fail.
- `PaymentConfig = { amount: number | ((req: Request) => number |
  Promise<number>); currency: 'SAT' | 'USD'; expirySeconds?: number }`.

**Private but stable token primitives** (`@moneydevkit/core/mdk402/token`,
re-readable at `dist/mdk402/token.js`):
- `createL402Credential({ paymentHash, amountSats, expiresAt,
  accessToken, resource, amount, currency })` — returns
  `base64(JSON({paymentHash, amountSats, expiresAt, resource, amount,
  currency, sig}))` where
  `sig = HMAC-SHA256(deriveL402Key(accessToken),
  paymentHash\0amountSats\0expiresAt\0resource\0amount\0currency).hex`
- `verifyL402Credential(credential, accessToken)` — HMAC + format
  check; **does NOT check expiry** ("a paid credential never expires").
- `verifyPreimage(preimage, paymentHash)` — `SHA256(preimage_bytes) ===
  paymentHash`. Same as Agora's existing helper.
- `parseAuthorizationHeader(header)` — accepts both `L402` and `LSAT`
  schemes per bLIP-26 backwards compat; returns
  `{valid: true, macaroon, preimage} | {valid: false, attempted}`.
- `deriveL402Key(accessToken)` — `HMAC-SHA256(accessToken,
  'mdk402-token-v1')` (domain separation from checkout/webhook keys).

### Wallet integration — TIGHTLY COUPLED

Real-mode `withPayment` requires:
- `MDK_ACCESS_TOKEN` — account-keyed API token from
  <https://moneydevkit.com>.
- `MDK_MNEMONIC` — BIP39 seed for the self-custodial node.
- A network round-trip to the hosted MDK API for **every** call:
  `client.checkouts.create()`, `client.checkouts.mintInvoice()`,
  `client.checkouts.redeemL402()` /
  `client.checkouts.checkL402()`. The credential-consumed state lives
  on MDK's backend (idempotency is server-side, not in the seller's DB).
- The actual Lightning node (`@moneydevkit/lightning-js`) is a NAPI
  Rust binding that runs ldk-node on the seller, but the LSP and
  channels are MDK-managed. This is the correct read of "serverless
  Lightning."

### Sandbox/mock — INCOMPLETE for our needs

`MDK_PREVIEW=1` (or running on a `*.replit.dev` host) toggles
`is_preview_environment()`, which **only skips preimage verification**
in `verifyCredential`. The HTTP calls to `mainnet.moneydevkit.com` for
checkout/invoice/redeem are still made. There is **no** fully-offline
mock path in `@moneydevkit/core` as of `0.16.0`.

Our test gates run offline, with no real network and no MDK account.
Per principle #1, mock mode must keep working without any external
service. So `MDK_PREVIEW` alone is insufficient.

## Decision

### Integration mode — MDK-with-offline-shim (hybrid)

| Mode      | Trigger                       | What runs                                                                   |
|-----------|-------------------------------|-----------------------------------------------------------------------------|
| **Real**  | `MOCK_MODE=false` AND `MDK_ACCESS_TOKEN` + `MDK_MNEMONIC` set | Provider routes go through MDK's `withPayment` end-to-end (real bolt-11, MDK-hosted node, MDK redemption).                                |
| **Mock**  | `MOCK_MODE=true` (default)    | Offline shim mints / verifies **MDK-shape macaroons** byte-for-byte; uses Agora's existing mock wallet for fake bolt-11 + deterministic preimages; idempotency lives in the seller's existing SQLite invoices table. |

This satisfies:
- **Principle #1** (mock works offline) — yes, no network, same SQLite.
- **Principle #4** (wire format frozen) — yes, the wire protocol
  (`Authorization: L402 <macaroon>:<preimage>`, the `body` JSON shape,
  endpoint URLs and HTTP semantics) is unchanged. The macaroon FORMAT
  changes (it's now MDK-shape `base64(JSON({…,sig}))` instead of the
  old `base64url(json).hmac`); buyers treat the macaroon as opaque, so
  this is invisible to them.
- **Principle #6** (test before merge) — yes, all 10 gates keep
  running. `test-phase0` byte-format assertion is updated to assert
  the new format AND that the soft-transition fallback verifier still
  parses old macaroons.
- The SPIRAL "use MDK" preference — yes, real mode goes through
  MDK's exact code paths; mock mode emits the same wire bytes.

### Macaroon wire format — MDK shape (NEW)

```
base64(JSON({
  paymentHash:  "<64 hex>",
  amountSats:   <int>,
  expiresAt:    <unix seconds>,
  resource:     "<METHOD>:<path>",
  amount:       <int (sats or USD cents)>,
  currency:     "SAT" | "USD",
  sig:          "<64 hex of HMAC-SHA256(deriveL402Key(secret), paymentHash\\0amountSats\\0expiresAt\\0resource\\0amount\\0currency)>"
}))
```

Differences from the previous Agora format:
- **Encoding:** `base64` (not `base64url`) of one JSON blob — `sig` is
  inside the JSON, not appended after a `.` separator.
- **HMAC key:** `deriveL402Key(secret) = HMAC-SHA256(secret,
  'mdk402-token-v1')` — keyed via a one-step KDF tag, NOT raw
  `secret`.
- **Resource binding:** `<METHOD>:<path>` (e.g. `POST:/v1/listing-verify`)
  instead of bare `<path>`. The verifier reconstructs from
  `req.method + ':' + new URL(req.url).pathname` exactly as MDK does.
- **Field names:** camelCase (`paymentHash`, `amountSats`, `expiresAt`)
  instead of snake_case (`payment_hash`, `amount`, `exp`).
- **Expiry:** the verifier does NOT check `expiresAt` — once a
  credential is paid (preimage matches), it's permanently valid (per
  MDK's design). The provider's seller-side `invoices` table still
  enforces single-use, so this is safe.

### Soft-transition verifier (one-cycle compat window)

The new `verifyAuth(authHeader, expectedResource)` in
`packages/agora-core/src/l402.ts` runs:
1. `parseAuthorizationHeader(authHeader)` — same as before, accepts
   both `L402` and `LSAT` schemes.
2. Try `verifyMdkMacaroon(macaroon, secret)`. On success, continue.
3. On parse/sig failure, fall back to `verifyLegacyMacaroon(macaroon,
   secret)` — the old `base64url(json).hmac` format.
4. `verifyPreimage(preimage, body.paymentHash)` and
   resource-equality check (mapped to METHOD:path).

Buyers minted before this ADR keep working until the next major
release. After one cycle the legacy verifier is removed.

### Seller secret — `L402_SECRET`

In real mode, MDK's `withPayment` reads `MDK_ACCESS_TOKEN` directly.
In mock mode, the offline shim reuses the existing `L402_SECRET`
(unchanged env var, no migration). This keeps the seller's identity
material in one place — `MDK_ACCESS_TOKEN` for real Lightning,
`L402_SECRET` for mock-mode HMAC seed. We do NOT cross-wire them.

### Plain-Node sellers (dataset-seller, market-monitor)

`@moneydevkit/nextjs/server` is Next.js-only. For the plain-Node
sellers (`agents/dataset-seller/src/server.js`,
`agents/market-monitor/src/server.js`) we wrap MDK's lower-level
exports — `parseAuthorizationHeader`, `verifyL402Credential`,
`verifyPreimage` — and call MDK's `client.checkouts.create + mintInvoice
+ redeemL402` directly via `@moneydevkit/core/mdk-client` in real mode.
In mock mode we use the same offline shim as the provider. The
existing per-seller SQLite invoice store keeps single-use enforcement
in mock mode.

### What's actually paywalled

Same set as before — no new endpoints become L402-gated:
- `POST /api/v1/listing-verify` (provider, 240 sat) — migrate.
- `POST /api/v1/order-receipt` (provider, 120 sat) — migrate.
- `POST /api/v1/dataset/:id/purchase` (dataset-seller, 5000 sat) —
  migrate.
- `POST /api/v1/subscribe` (market-monitor) and the provider's
  `/api/v1/subscribe` — these are **trust-deposit, not L402-gated** per
  ADR 0005. **No L402 work here.** Surface unchanged.

## Consequences

- The seller-side macaroon byte format changes. Buyers don't care
  (opaque blob). The soft-transition verifier accepts old format for
  one cycle.
- `provider/src/lib/l402.ts` becomes a thin re-export of
  `@agora/core`'s new L402 wrapper. The actual minting / verifying
  logic lives once in `packages/agora-core/`.
- `packages/agora-core/src/l402.ts` grows to ~250 lines: MDK-shape
  mint/verify, legacy-shape verify, `require402`, `verifyAuth` with
  soft-transition fallback, the `parseAuthHeader` helper, and the
  `challengeHeader` builder. All exports keep their current names so
  consumer files don't churn.
- `provider/src/lib/wallet.ts` stays as the source of mock-mode bolt-11
  invoices and the NWC adapter for ad-hoc real-mode use. In real
  mode with MDK, the wallet adapter is bypassed by `withPayment`'s
  hosted-node mint. We keep the file (not delete) because the
  provider's `/api/dev/pay` endpoint and the buyer-side flow still
  rely on it for offline mock invoice lookup.
- `test-phase0.js`'s byte-format assertion is updated to assert:
  - the NEW MDK-shape format on a mint roundtrip;
  - the soft-transition verifier accepts a hand-crafted old-format
    macaroon (proves the deprecation window is live).
- New env vars (real mode only): `MDK_ACCESS_TOKEN`, `MDK_MNEMONIC`.
  Documented in README and PAYMYAGENT. `L402_SECRET` is still required
  in mock mode (it was already required for the legacy mint path).

## Migration timeline

- This phase: dual-format verifier; new mints are MDK-shape; old-shape
  buyers still verify.
- One major-version bump from now: drop the legacy verifier; only
  MDK-shape mints accepted.

## Known limitations

- Real-mode requires a live `mainnet.moneydevkit.com` connection on
  every paid call. There is no offline real-mode. Document in
  `docs/BUILD-BLOCKERS.md` if it becomes a blocker for any test gate.
- Real-mode requires an MDK account / API token from
  <https://moneydevkit.com>; we do not test this path in CI (would
  require a secret). All 10 test gates run in mock mode, which is the
  default.
- MDK's idempotency is server-side; if the MDK backend is down, real
  mode breaks. The provider falls through to a 502 from MDK's wrapper
  — buyers see a clean error code. Mock mode is unaffected.
- `@moneydevkit/lightning-js` is a Rust NAPI binary. We don't load it
  in mock mode (the offline shim uses Node's stdlib only). In real mode
  it's pulled in via `@moneydevkit/nextjs`'s transitive dependency.

## Open questions

None. The pattern is mechanical and the tests are exhaustive.
