# Andromeda — security audit

Independent security review. Auditor had no prior context. Methodology:
read `README.md`, `PAYMYAGENT.md`, `docs/BUILD-SUMMARY.md`, every ADR in
`docs/decisions/`, then read source for every endpoint that mints a
macaroon, verifies a signature, charges a sat, or persists trust. Live
probes were executed against a local registry (port 3030) and provider
(port 3000) in mock mode; throwaway probe scripts were written, run, and
deleted.

No code was modified.

---

## Threat model summary

The Andromeda system (multi-seller registry + Lightning-paywalled
providers + MCP buyer) defends against four buckets of adversary:

1. **Network attacker / replay** — captures HTTP traffic, replays signed
   requests or paid macaroons. Defended by Ed25519 signed-request headers
   with ±5min clock skew, HMAC-signed L402 macaroons with `exp`, and (on
   the main provider) a `consumed` flag in the invoices table.
2. **Off-protocol grifter** — calls endpoints without auth, hoping
   something is open. Defended by signed-request middleware on all
   `POST` endpoints to the registry, L402 challenge on every paid path,
   and HTTP-Basic on `/v1/stats`.
3. **Sybil rater / honor inflator** — registers many pubkeys to game
   the seller-honor leaderboard. Defended (per ADR 0010) by the
   "transacted in last 30 days" rule before a buyer can rate.
4. **Insider seller / reviewer fraud** — a registered seller files a
   review of itself, gets a colluding reviewer assigned, and badges
   itself; or a reviewer submits a low-effort review and pockets escrow.
   Defended (per ADR 0010) by blind random reviewer assignment with
   exclude-self, plus reviewer-side slashing.

This audit confirms #1 and #2 are robust. #3 and #4 fail in critical
ways: the "transacted within 30 days" check is enforced against the
registry's own ledger, but **the seller is the sole signer of the
transaction record** and the seller may write **any string they like**
in `buyer_pubkey`, including a Sybil pubkey they also control. The
exploit recipe is below (P0).

---

## Per-category findings

### A. Signature integrity (Ed25519 signed requests)

| Test                                    | Result    |
|-----------------------------------------|-----------|
| Replay with stale timestamp (10min old) | Rejected (401 "timestamp outside ±5min window") |
| Signature stripping                     | Rejected (401 "missing signature headers") |
| Cross-pubkey: sign with A, body claims pubkey B | Rejected (403 "body pubkey must match signing pubkey") on `/v1/sellers/register`. Same pattern on `/v1/transactions/record` (seller-pubkey check). |
| Forged Ed25519 signature                | Rejected (401 "signature invalid") via `verifyUtf8` returning false. |

Crypto core is sound: `@noble/ed25519` v2 + sha512 sync hook in
`packages/andromeda-core/src/crypto.ts`. The canonical-string format
(`<METHOD>\n<PATH>\n<sha256-of-body-or-empty-string>\n<TIMESTAMP>`) binds
method, path, body hash, and timestamp; replay outside the window
fails. `verifyRequest` rejects on `Math.abs(now - ts) > window`.

**No P0/P1 findings in this category.** One P3:

- **P3 — `/v1/transactions/record` body fields are unvalidated beyond
  presence.** The seller signs the row, and the `seller_pubkey` field
  must match the signer (good), but `buyer_pubkey` is an opaque string
  with no signature loop-back. This isn't a vulnerability of the
  signature scheme itself — it's a model gap (see P0-1 below).

### B. L402 paywall integrity (provider)

| Test                                          | Result    |
|-----------------------------------------------|-----------|
| Forged macaroon (random HMAC tail)            | Rejected (401 "invalid or expired macaroon") |
| Cross-resource replay: macaroon scoped to listing-verify, replayed on order-receipt | Rejected (401 "macaroon scoped to a different resource") |
| Single-use enforcement: same macaroon+preimage replayed twice on listing-verify | First call 200; second call 409 "already_consumed" |
| Pay one, consume one: `markInvoiceConsumed` is `UPDATE … WHERE status IN ('pending','paid')` (atomic) | Race-safe via SQLite atomic UPDATE |
| Preimage check: SHA256(preimage) === payment_hash | Enforced in `verifyAuth` line 134-136 |
| Macaroon `exp` check                          | Enforced in `verifyMacaroon` (provider/src/lib/l402.ts:55) |
| HMAC compare uses `timingSafeEqual`           | Yes (l402.ts:49–52) |

The provider's L402 implementation is the strongest part of the
codebase. **No P0/P1 findings.**

**P1 — Dataset seller does NOT enforce single-use on its L402 macaroons.**
`agents/dataset-seller/src/server.js:236–267` verifies macaroon HMAC,
checks resource scope, and verifies preimage, but uses an **in-memory**
map (`invoices`) that is `delete()`d after first success. The macaroon
itself remains valid until `exp` (300 s by default). After the
provider deletes the invoice, replaying the same `Authorization: L402
<macaroon>:<preimage>` succeeds again because:

1. `verifyMacaroon(parsed.macaroon, L402_SECRET)` ignores the in-memory
   map — it only checks HMAC + `exp`.
2. `verifyPreimage` ignores it — it only checks SHA256(preimage) ===
   payment_hash.
3. `invoices.delete(macBody.payment_hash)` happens AFTER verification;
   the next call simply does nothing on a missing key.

Net effect: a buyer who paid once for a 5,000-sat dataset can mint
unlimited 24-hour signed download URLs for 5 minutes (until macaroon
exp). The platform-fee counter (`recordTx`) is also re-incremented per
replay, polluting platform revenue accounting.

This contradicts the provider's frozen contract (`provider/src/lib/l402.ts`
has the SQLite-backed `markInvoiceConsumed` flip; the dataset seller
reimplemented L402 without that anchor). Severity: **P1** (one-time
financial loss capped at 5 min × replay rate × URL freshness, but the
spec is broken and signed URLs are valid for 24 h afterwards).

**P2 — `agents/dataset-seller`: signed download URL secret falls back to
the literal string `"fallback"` when `L402_SECRET` is unset.**
`agents/dataset-seller/src/server.js:126,133`:
```
createHmac("sha256", L402_SECRET || "fallback").update(payload)
```
A misconfigured deployment with no `L402_SECRET` produces predictable
signed URLs anyone can mint. Same anti-pattern in
`agents/market-monitor/src/server.js:153` for alert signatures. Both
emit a `console.warn` if `L402_SECRET.length < 32`, but they don't
exit; ops can ignore the warning. Severity: **P2**.

### C. Wallet safety / budget guardrails

| Test                                                  | Result          |
|-------------------------------------------------------|-----------------|
| `MOCK_MODE=true` honored at wallet boundary           | Yes — `wallet()` selector in provider/src/lib/wallet.ts:88, and `MOCK = process.env.MOCK_MODE === "true"` in mcp/lumen-client.js:26 |
| Real NWC client never instantiated in mock mode       | Yes — `_ln=null` short-circuits in mock |
| Per-call cap (`MAX_PRICE_SATS`)                       | Enforced in lumen-client.js:61 |
| Kill-switch refuses paid tools                        | Enforced in budget.js:78–80 (`reserve()` returns "kill_switch_active") |
| Kill-switch persisted across MCP reload                | Yes — `.mcp-session.json` stores `kill_switch_active` |
| Budget reset clears spent-counter                     | Yes — `setBudget` zeroes `spent` (budget.js:99). Note: per ADR 0006, "Resetting the budget does NOT auto-disable the kill-switch" — the `setBudget` function correctly leaves `kill_switch_active` untouched. |

**P1 — Budget cap can be bypassed by parallel tool calls (TOCTOU).**
`mcp/budget.js` exposes `reserve(amount)` and `confirm(amount)` as
SEPARATE calls. `reserve` checks `state.spent + amount > state.budget`
but does not mutate `state.spent`. `confirm` adds `amount` to
`state.spent`. The MCP client (`mcp/lumen-client.js:65–70`) does:

```
const reason = reserve(challenge.amount_sats);   // CHECK ONLY
if (reason) throw …;
const { preimage, fees_paid } = await pay(challenge);   // ASYNC PAY
confirm(challenge.amount_sats);                  // MUTATE
```

Two concurrent tool invocations (e.g., the model issues
`andromeda_verify_listing` and `andromeda_file_receipt` in parallel via
the same MCP session) both pass the `reserve()` check on the same
unmodified `state.spent`, both proceed through `await pay(...)`, and
both eventually confirm — overspending the cap by N×price.

Concretely with `MAX_BUDGET_SATS=200` and four concurrent 240-sat
verifies: each `reserve(240)` sees `spent=0`, all four pass, all four
pay, total spent=960 — **4.8× the cap**. The bug is in the contract,
not the test scaffold.

The single-process, single-thread Node event loop makes this less
common than a multi-process race, but `await pay(...)` yields control
and parallel calls do interleave. Severity: **P1** because the budget
guardrail is the thing keeping a buggy LLM from draining a wallet.

**P2 — Budget state on disk is best-effort; `save()` swallows errors.**
budget.js:46–52 — if the file write fails (read-only mount, EACCES,
quota), the in-memory budget continues to debit, but a process restart
re-loads stale state. Could allow budget circumvention via crash-loop:
spend → kill provider before save flushes → restart loads pre-spend
state. The state writer doesn't fsync. Severity: **P2** for live
deployment; **P3** in the demo context.

**P3 — No integrity check on `.mcp-session.json`.** A user who can
write to the session file (or any program running as them) can flip
`kill_switch_active=false` or zero `spent`. Not exploitable by network
adversaries but worth noting since the file is treated as authoritative.

### D. Peer-review escrow integrity

| Test                                                  | Result          |
|-------------------------------------------------------|-----------------|
| Submit review for a request you weren't assigned       | Rejected (409 "you are not the assigned reviewer") |
| Self-review: same identity asks for review of itself  | Rejected — `pickRandomReviewer(excludePubkey)` excludes the requester (registry/src/lib/reviews.ts:14). With one available identity (the requester), 409 "no reviewers available." |
| Reviewer can be slashed without slashing event        | Slashing always inserts a `slashing_events` row (reviews.ts:154–157). |
| Submission validates rubric (5-char min justifications, scores 0..5) | Yes — `validateReviewSubmission` in `packages/andromeda-core/src/review-rubric.ts:34–48`. |
| Escrow split 95/5 on honest review                    | Confirmed: 200-sat escrow → 190 reviewer + 10 platform. |

**P0 — Anyone can slash any reviewer.** `POST /v1/reviews/:id/dispute`
(`registry/src/app/api/v1/reviews/[id]/dispute/route.ts`) requires only
that the dispute body be Ed25519-signed by SOME identity — there is no
check that the disputer is the requester, the buyer of the subject, or
even has any relationship with the review. Because `slashReviewer`
unconditionally applies `-50` honor and clawbacks the entire escrow
back to the requester, any registered actor can:

1. Watch `/v1/reviews/assigned?reviewer_pubkey=<R>` (public read) to
   find a reviewer's open submissions.
2. POST `/v1/reviews/<review_id>/dispute` signed with a fresh
   throwaway keypair and `{reason: "fraud"}`.
3. The reviewer loses 50 honor; the requester gets back the escrow
   (full clawback).

Live probe (recipe in `tmp_probe2.mjs t12_dispute_smart`): a
freshly-generated `RANDO` keypair successfully disputed a review
submitted by `R`. Server response:

```
{"ok":true,"honor_delta":-50,"escrow_returned":80,"event_id":"slash_…"}
```

This is a denial-of-trust primitive: an attacker can grief every
reviewer in the registry until none remain available. The dispute path
also serves as a **collusion vehicle**: a seller who paid for a review
can dispute it via a clean throwaway pubkey if they don't like the
score, then re-request and gamble for a more lenient reviewer — at no
cost beyond gas. The route's own comment honestly admits *"Phase 5
v0: trust the dispute (a real implementation would run silent
re-review here)"* — but the limitation is not surfaced in
`docs/BUILD-SUMMARY.md`'s "Known limitations" except indirectly
("Phase-5 silent re-review sampling isn't running. The dispute path
slashes on demand based on user input"). Severity: **P0**.

**P1 — Dispute does not check that the review still exists in the
right state, or that the request is unresolved.** Repeated disputes
of the same review work because `slashReviewer` is idempotent only on
the slashing-events table; there's no check that
`review_requests.status != 'slashed'` before clawing escrow again.
This isn't easy to weaponize (escrow is set to 0 on first slash in the
review_requests row, but the seller's honor takes another -50 each
time). Severity: **P1**.

**P3 — Reviewer assignment is not as blind as advertised.** ADR 0010
admits the seller's pubkey is discoverable from `service_id` (which
embeds `seller_pubkey.slice(0,8)` per `db.ts:upsertService`). With 8
hex chars (32 bits), the prefix is ~de-anonymizable: in a registry of
N sellers, the chance of two identical 8-hex prefixes is N²/2³³.
Already noted in `docs/audit-design.md` C-2.

### E. Sybil & reputation

**P0 — Self-rating attack succeeds: an attacker can inflate honor
arbitrarily by registering both seller and "buyer" pubkeys.**

Recipe (validated live; results captured in probe output):

1. Attacker generates two Ed25519 keypairs: `seller`, `buyer`.
2. Attacker `POST /v1/sellers/register` signed by `seller`. (Status: 200.)
3. Attacker `POST /v1/transactions/record` signed by **`seller`** with
   body `{seller_pubkey: seller.pub, buyer_pubkey: buyer.pub,
   payment_hash: random32bytes, amount_sats: 100, …}`. The route
   (`registry/src/app/api/v1/transactions/record/route.ts:30`) checks
   only that `seller_pubkey === auth.pubkey` — i.e. the seller signs
   their own ledger entry. The `buyer_pubkey` field is **never
   verified**: it's a free-form string. (Status: 200, recorded:true.)
4. Attacker `POST /v1/sellers/<seller.pub>/rate` signed by `buyer`
   with `{stars: 5}`. The handler calls `rateSeller`
   (`registry/src/lib/reviews.ts:49–69`), which checks "did this buyer
   transact with this seller in the last 30 days?" by querying the
   transactions ledger — and YES, the row inserted in step 3 satisfies
   the check. Honor += 2. (Status: 200, new_honor:2.)

Loop steps 3–4 with N fresh `buyer` keypairs to inflate honor by 2N
per iteration. Cost: zero (no Lightning settlement is required because
the seller is asserting their own sales record into the registry; the
provider's L402 path is bypassed entirely for the registry-side
attack). The provider DOES enforce real-payment settlement before
calling `recordTxFireAndForget`, but **the registry has no way to
verify a recorded transaction was settled on-chain** — it trusts the
seller's signature.

A 5-iteration probe in `tmp_probe2.mjs t9` confirmed honor reached the
expected accumulated value with five Sybil "buyers."

ADR 0010 §"Honor model" anticipates this only for buyer-rating
fraud, not seller-side ledger forgery: *"Buyers who submit fraudulent
ratings (caught by the dispute path) lose ALL their pending honor and
are barred from rating that seller again. (Not implemented in Phase 5
v0 — flagged in docs/BUILD-BLOCKERS.md if necessary.)"* The spec
assumes the buyer pubkey is bound to a real Lightning payment; the
implementation never makes that binding. Severity: **P0**.

**Mechanism that DOES prevent some abuse:** the `30-day cutoff` on
buyer ratings (reviews.ts:56–62) does correctly stop a buyer from
rating someone they've never transacted with — IF the ledger entries
are honest. The flaw is that the ledger entries are not honest:
they're seller-signed claims.

**P0 — The `x-andromeda-pubkey` header on provider paid endpoints lets
the buyer (or an attacker controlling the network path) write any
string into the registry's `buyer_pubkey` column.** The provider's
`recordTxFireAndForget` call in
`provider/src/app/api/v1/listing-verify/route.ts:38` reads:

```
buyer_pubkey: req.headers.get("x-andromeda-pubkey"),
```

That value is not verified. Any HTTP client can set it to a Sybil
pubkey it controls. Combined with a real (mock or mainnet) L402
payment, this lets an attacker make the registry believe an
attacker-controlled "buyer" pubkey transacted with the seller. The
registry then accepts a 5-star rating from that pubkey. Live probe in
`tmp_probe2.mjs t14` confirmed 200 OK with the spoofed buyer header.

This is the same Sybil primitive as P0-Self-Rating but funneled
through a real provider payment. Even with mainnet sats moving, the
attacker's cost is ~240 sat per rating ($0.16 at $67k/btc), which
funds an unbounded honor inflation: 240 sats per +2 honor = 120 sats
per 1-honor unit. A 1,000-honor inflation costs $160 of real Lightning
sats moved between two attacker-controlled wallets — round-tripped
through Alby. Severity: **P0**.

### F. Privacy

**P2 — Subscription endpoints leak across buyers.**
`/api/v1/subscriptions/{id}/alerts` (provider and market-monitor) is
**unauthenticated**. Anyone who knows or guesses a `subscription_id`
(24-char base16 from `randomUUID().replace(/-/g,'').slice(0,24)`,
i.e. ~96 bits) can read every alert ever delivered to any subscriber,
including their pubkey on the GET-by-id endpoint
(`/api/v1/subscriptions/{id}`). 96 bits of unguessable entropy is
ample, but the URL leaks anywhere it shows up: logs, request-tracing,
proxy histories, browser caches.

**P0 — Subscriptions are unauthenticated. ANY caller can subscribe on
behalf of any pubkey, top-up any subscription, or cancel any
subscription.** Live probe confirmed `POST /api/v1/subscribe` accepts
arbitrary `subscriber_pubkey`. The provider route
(`provider/src/app/api/v1/subscribe/route.ts`) and market-monitor's
inline handler both call `createSubscription` with no signature check.

The top-up route (`provider/src/app/api/v1/subscriptions/[id]/topup/route.ts`)
runs `topUpSubscription(id, body.sats)` without ANY payment or
signature step — the literal code path increments the balance counter
in SQLite based purely on a request body. This is acknowledged in
ADR 0005 and BUILD-SUMMARY §"Phase-2 subscribe trust-deposits" but is
not gated to mock mode: in real mode the same code runs, no actual
sats arrive, and the buyer's "balance" is arbitrary.

Cancel similarly takes no auth; the response advertises `refunded_sats`
which would imply a real-mode NWC payback, but ADR 0005 §"Cancel
returns balance" admits the real-mode refund is deferred. In mock
mode, ANY caller can cancel ANY subscription and receive a phony
`refunded_sats` value. In real mode, the seller sends sats to whoever
they think the subscriber is — but they were trusted to know that on
subscribe, when no signature was checked. Severity: **P0** (because
nothing about this matches the user-facing claim that subscriptions
are paid prepaid balances).

**P3 — Local control-token at `~/.andromeda/control-token` is mode-0600
on Linux/macOS, best-effort on Windows.** `mcp/control-plane.js:42`
passes `mode: 0o600` to `writeFileSync`, which is honored on POSIX. On
Windows the host filesystem ACLs apply; a local user-process boundary
is the only protection. The code admits this in a comment (line 43)
but doesn't take a defensive step like calling `fs.chmod` on
re-invocation, or warning the user. Acceptable for a local-trust
demo, but worth noting per the audit prompt.

### G. Misc / hardening

**P1 — Rate limiting is bypassed by spoofing `x-forwarded-for`.**
`provider/src/lib/ratelimit.ts:16–21` — `ipFrom(req)` reads the first
value of `x-forwarded-for`, which is fully attacker-controlled when
the provider runs without a real reverse proxy stripping/setting that
header. Live probe (50 requests with `x-forwarded-for: 1.2.3.<i>` for
i in 0..49): **0/50 rate-limited**. Same 50 requests with a constant
IP: 14/50 rate-limited. Severity: **P1** when the provider is exposed
publicly without a trusted reverse proxy.

**P2 — Admin endpoints default to `dev-admin-secret` if `ADMIN_SECRET`
isn't set.** `registry/src/app/api/v1/admin/decay/route.ts:14` and
`registry/src/app/api/v1/platform/revenue/route.ts:10`:

```
const expected = process.env.ADMIN_SECRET ?? "dev-admin-secret";
```

A registry running with the default env passes `x-admin-secret:
dev-admin-secret` for full admin access — including
`/v1/admin/fast-forward` which back-dates all sellers' `last_active_at`
(can force-decay every seller's honor). Live probe confirmed both
`/admin/decay` and `/platform/revenue` return 200 with the default
secret. Severity: **P2** (well-known footgun; comparable to default
passwords).

**P3 — HTTP Basic auth on `/v1/stats` uses non-constant-time string
compare.** `provider/src/lib/admin-auth.ts:30`:

```
if (u !== user || p !== pass) { return errorResponse(...); }
```

Should use `crypto.timingSafeEqual`. Practical timing leakage over
LAN/WAN is hard to weaponize; severity: **P3**.

**P3 — `signing_secret` for the slashing-event audit log defaults to
`"registry-default-secret-please-set-something-stronger"`** when
neither `ANDROMEDA_REGISTRY_SECRET` nor `L402_SECRET` is set.
`registry/src/app/api/v1/reviews/[id]/dispute/route.ts:19`. Even with
a strong secret, the HMAC just signs the row's own audit log; it
doesn't gate any write. Mostly cosmetic. Severity: **P3**.

**P3 — `~/.andromeda/control-port` and `subscriptions.json` paths are
not mode-checked at every read.** `mcp/control-plane.js`:32 calls
`fs.mkdirSync(... mode: 0o700)` on first creation, but if the dir
exists with weaker perms, no chmod happens. Severity: **P3**.

**P3 — Provider's `fire-and-forget` registry write does not retry or
log durably.** A network blip between provider and registry silently
drops the transaction. Not an attacker primitive but means the
honor-rate path (which depends on transactions being recorded) can be
silently starved. Out of scope for security per se; flagged because
it's the underlying cause of test flakiness referenced in BUILD-SUMMARY.

---

## Specific exploits that worked (live, in mock mode)

| ID  | Severity | Exploit                                                                                                            | Source endpoint                                |
|-----|----------|--------------------------------------------------------------------------------------------------------------------|------------------------------------------------|
| E-1 | P0       | Sybil honor inflation via seller-signed forged transactions + Sybil-buyer-signed ratings. ~zero cost.              | `/v1/transactions/record` + `/v1/sellers/:pubkey/rate` |
| E-2 | P0       | Honor inflation via spoofed `x-andromeda-pubkey` header on real L402 paid endpoint, then Sybil-buyer rating. Cost: per-rating L402 price. | `/api/v1/listing-verify` (header) + `/v1/sellers/:pubkey/rate` |
| E-3 | P0       | Anyone can dispute any review with a throwaway keypair, slashing the reviewer -50 honor and clawing back escrow.   | `/v1/reviews/:id/dispute`                      |
| E-4 | P0       | Anyone can subscribe on behalf of any pubkey; anyone can top up any subscription for free; anyone can cancel any subscription. | `/api/v1/subscribe`, `.../topup`, `.../cancel` |
| E-5 | P1       | Dataset-seller does not enforce single-use on its L402 macaroons. Pay once → unlimited signed download URLs for ~5 min. | `agents/dataset-seller POST /api/v1/dataset/:id/purchase` |
| E-6 | P1       | Budget cap bypass via parallel tool calls (TOCTOU between `reserve()` and `confirm()` in `mcp/budget.js`).         | MCP `mcp/lumen-client.js` callPaidEndpoint     |
| E-7 | P1       | Rate-limit bypass on provider via spoofed `x-forwarded-for`.                                                       | `/api/v1/listing-verify`, `/api/v1/order-receipt` |
| E-8 | P2       | Admin endpoints accept the default secret `dev-admin-secret`.                                                      | `/v1/admin/decay`, `/v1/admin/fast-forward`, `/v1/platform/revenue` |
| E-9 | P2       | Anyone can read every alert delivered to any subscription, given the subscription_id.                              | `/api/v1/subscriptions/:id/alerts`             |
| E-10| P2       | `agents/dataset-seller` and `agents/market-monitor` use HMAC secret `"fallback"` if `L402_SECRET` is unset.        | `signDownloadUrl`, `signAlert`                 |

---

## Specific exploits that were prevented, with the mechanism

| ID  | Attempted exploit                                                            | Mechanism that blocked it                                                                                          |
|-----|------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| B-1 | Replay a 10-minute-old signed registry write                                 | `verifyRequest` rejects on `Math.abs(now - ts) > validityMs (5min)` — `signed-request.ts:95`                       |
| B-2 | Strip signature headers and POST                                             | `verifySignedRequest` rejects on missing `x-andromeda-pubkey/timestamp/sig` — `registry/src/lib/sig.ts:16`         |
| B-3 | Sign with key A, claim pubkey B in the body                                  | `register` route checks `body.pubkey === auth.pubkey` (403); `transactions/record` checks `seller_pubkey === auth.pubkey` (403) |
| B-4 | Forged macaroon (random HMAC tail) presented to provider                     | `verifyMacaroon` recomputes HMAC and `timingSafeEqual`s — `provider/src/lib/l402.ts:42–57`                         |
| B-5 | Cross-resource preimage: macaroon scoped `/v1/listing-verify` replayed on `/v1/order-receipt` | `verifyAuth` checks `body.resource !== expectedResource` (401)                                                     |
| B-6 | Replay the same valid L402 token twice on the provider's listing-verify       | SQLite atomic transition `pending|paid → consumed` in `markInvoiceConsumed` (db.ts:217–225); 2nd request gets 409 |
| B-7 | Submit a peer review for a request you weren't assigned to                   | `submitReview` checks `req.reviewer_pubkey === args.reviewer_pubkey` (409 "you are not the assigned reviewer")     |
| B-8 | Self-review (same identity is requester + reviewer, only candidate available) | `pickRandomReviewer(excludePubkey)` filters `r.pubkey != excludePubkey` (returns null → 409 "no reviewers available") |
| B-9 | Mock-mode-only `/api/dev/pay` and `/api/dev/fire-alert` reachable in real mode | Both routes early-return `if (process.env.MOCK_MODE !== "true")` — provider/src/app/api/dev/*/route.ts             |

---

## Dependency scan results

`npm audit` per workspace (run 2026-04-26):

| Workspace                       | Total | Critical | High | Moderate | Low |
|--------------------------------|-------|----------|------|----------|-----|
| `/` (root)                     | 2     | 0        | 0    | 2        | 0   |
| `provider/`                    | 2     | 0        | 0    | 2        | 0   |
| `registry/`                    | 2     | 0        | 0    | 2        | 0   |
| `mcp/`                         | 0     | 0        | 0    | 0        | 0   |
| `buyer/`                       | 0     | 0        | 0    | 0        | 0   |
| `agents/market-monitor/`       | 0     | 0        | 0    | 0        | 0   |
| `agents/dataset-seller/`       | 0     | 0        | 0    | 0        | 0   |

The two moderate findings are the same advisory across the three
workspaces that pull in Next.js: `postcss <8.5.10` (GHSA-qx2v-qp2m-jg93,
"PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output",
CVSS 6.1). PostCSS is a build-time transitive dependency of Next.js
and not directly invoked by Andromeda code; the XSS path requires
crafted `</style>` content reaching `CSS.stringify`, which Andromeda
does not exercise. Risk in the runtime path is theoretical.

No high/critical findings. No supply-chain pinning issues observed
beyond standard `package-lock.json` hashes.

---

## Summary table

- **P0 findings (4):** E-1 (Sybil rating via forged tx), E-2 (Sybil via
  spoofed buyer header), E-3 (anyone slashes any reviewer),
  E-4 (subscriptions are unauthenticated).
- **P1 findings (3):** E-5 (dataset-seller no single-use),
  E-6 (budget TOCTOU), E-7 (XFF rate-limit bypass).
- **P2 findings (3):** E-8 (default admin secret), E-9 (subscription
  alerts world-readable given id), E-10 (HMAC fallback secret).
- **P3 findings (~7):** signing-secret defaults, non-constant-time
  HTTP-Basic compare, mode-0600 best-effort on Windows, weak slashing
  signing secret, unguarded fire-and-forget tx writes, etc.

---

## Notes on scope

- Real-mode mainnet was not exercised. Mock-mode L402 settlement is
  represented by an in-process map; real-mode adds an
  `nwcClient.lookupInvoice` call before the consume flip
  (provider/src/lib/l402.ts:139–143). The auth-side primitives are the
  same in both modes; payment-settlement bypass requires compromising
  the NWC backend (out of scope).
- The Tauri desktop GUI was confirmed deferred (ADR 0006); only the
  headless `mcp/control-plane.js` was reviewed.
- The Phase-7 public web index (`web/`) is a stub and was not reviewed.

No fixes are proposed in this document.
