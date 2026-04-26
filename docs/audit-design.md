# Andromeda — design audit

Independent paper review. No code changes. Reviewer had no prior context;
findings are based on `README.md`, `PAYMYAGENT.md`, `docs/decisions/0001..0010`,
`docs/BUILD-SUMMARY.md`, `CHANGELOG.md`, and a targeted read of the source.

---

## 1. Coherence findings

### 1.1 ADR-vs-ADR contradictions

**C-1. "No accounts, no email" vs. registry pubkey upsert.**
ADR 0001 (Identity) declares: *"There are no email addresses, no passwords,
no accounts. A keypair is generated on first run and persisted locally."*
ADR 0004 says: *"`POST /v1/sellers/register` is upsert-by-pubkey. The seller
signs the body so a stranger can't hijack a seller's row."* The registry
schema (`registry/migrations/0001-initial.sql`) has `sellers.pubkey PRIMARY
KEY` — i.e. the pubkey **is** the account. The contradiction is rhetorical:
the project repeatedly markets itself as account-free, but the registry
**is** an account system keyed by Ed25519 pubkey, with re-registration as a
write-protected upsert. Honest re-framing: "the account is your pubkey."

**C-2. ADR 0010 §"Reviewer assignment is BLIND" vs. its own footnote.**
The decision says assignment is *blind*, but step 3 admits: *"the seller's
pubkey is not directly hidden (it's discoverable from the service_id)."* The
implementation in `registry/src/lib/reviews.ts::pickRandomReviewer` confirms
the reviewer can derive the subject's pubkey trivially because
`review_requests.subject_pubkey` is stored alongside and the same row is
returned to the reviewer via `/reviews/assigned`. **This is at best
"pseudo-blind"**, not blind in the cryptographic sense the ADR's title
suggests.

**C-3. ADR 0008 mock-mode dataset description.** ADR 0008 says the dataset
is *"~200 MB Parquet"* and *"a small JSON fixture (~20 KB) representing a
stand-in"*. `agents/dataset-seller/src/server.js` always serves the JSON
fixture even in real mode — the only "real-mode" branch in the code is
`/api/dev/pay` being disabled. There is no Parquet, no env-pointed file
loader. Implementation drift: the "real-mode" path the ADR promises does
not exist.

**C-4. ADR 0010 silent re-review vs. dispute path.** ADR 0010 §"Two-sided
slashing" specifies *"silent re-review (5–10% sampled) with rubric scores
deviating > 2.0 from the consensus get -50 honor."* The actual code
(`registry/src/app/api/v1/reviews/[id]/dispute/route.ts`) slashes the
reviewer **on any well-formed dispute call signed by anyone** — it does not
verify the disputer is the buyer-of-record, does not run silent re-review,
and does not compute deviation. Build-summary §6.5 admits this honestly,
but the ADR is not amended; the contradiction stands in the design record.

**C-5. ADR 0001 §"Tx recording is signed by the SELLER".** ADR 0004 says
the seller signs because the seller knows the payment_hash. But
`recordTransaction` is idempotent only on `payment_hash` UNIQUE — the
seller can fabricate `buyer_pubkey` at will (the buyer never signs). ADR
0001's "buyer's identity is just a pubkey field in the body" is honest, but
this means **honor accrual is computed from a list the seller wrote
unilaterally**. See trust matrix below.

### 1.2 Code decisions absent from any ADR

- **D-1. Service-id format.** `${seller_pubkey.slice(0,8)}:${local_id}` is
  hardcoded in `registry/src/lib/db.ts`. Truncation to 8 hex chars (32
  bits of entropy) raises a small but real collision surface for service
  IDs across 2^16 sellers (birthday). No ADR.
- **D-2. Macaroon HMAC scope.** Only `payment_hash`, `resource`, `amount`,
  `exp` are bound. There is no buyer pubkey caveat, no per-issuance nonce,
  and no `audience` claim. A leaked macaroon+preimage replays anywhere
  until `exp`. No ADR.
- **D-3. `slashReviewer` writes a fake seller row.** When slashed, if the
  reviewer is not yet a seller, `INSERT INTO sellers (... name='(slashed
  reviewer)' url='' ...)` is forced. This silently registers a "seller" row
  with an empty URL just to hold the negative honor. No ADR; surfaces as a
  ghost seller in `GET /v1/sellers`.
- **D-4. `ANDROMEDA_REGISTRY_SECRET` fallback chain.** Dispute slashing
  signs evidence with `ANDROMEDA_REGISTRY_SECRET ?? L402_SECRET ??
  "registry-default-secret-please-set-something-stronger"` — the literal
  default is shipped as a string, which makes audit-log signatures
  unfalsifiable on any default deployment. No ADR.
- **D-5. `andromeda_purchase_dataset` requires the seller to expose
  `/api/dev/pay`.** Look at `mcp/server.js:651`: in mock mode the MCP just
  POSTs to the seller's `/api/dev/pay`. ADR 0008 implies a generic
  L402 flow, but the implementation has hard knowledge of a per-seller
  mock-pay endpoint. No ADR; coupling not documented.
- **D-6. Dataset-seller's `recordTx` uses `buyer_pubkey ?? "unknown"`.**
  Buyer attribution is best-effort via the optional `X-Andromeda-Pubkey`
  header, which the dataset-seller does **not** verify with a signature.
  An attacker who knows another buyer's pubkey can forge attribution. No
  ADR.

### 1.3 Architecture diagram vs. reality

ADR 0001's diagram shows a Tauri Dashboard at the bottom. **No Tauri shell
exists.** `dashboard/src/` contains two CLI shims (`control-plane-cli.js`,
`tauri-build-stub.js`). ADR 0006 admits the deferral, but ADR 0001's
diagram is not annotated to reflect "shell deferred." A naïve reader of
ADR 0001 will assume a GUI exists.

The diagram also collapses every seller (provider, monitor, dataset) into
the registry's HTTP path; in reality the registry is read-only for buyers
and the buyer-side MCP holds session state. The diagram does not show that
the MCP's localhost control plane is the only writeable surface a human
touches — a load-bearing detail.

---

## 2. Spec gaps

### 2.1 Built-but-not-claimed (silent additions)

| Endpoint / behavior                                  | Stated where? |
|------------------------------------------------------|---------------|
| `POST /api/v1/admin/fast-forward`                    | Build-summary only; no ADR |
| `POST /api/dev/tick` on market-monitor               | Build-summary only |
| Heartbeat 60s self-re-register                       | ADR 0004 footnote (not in 0001) |
| Reviewer ghost-seller insert (D-3)                   | Nowhere |
| Service-id 8-hex-prefix collision surface            | Nowhere |
| FTS5 query token sanitization                        | Nowhere |

### 2.2 Claimed-but-missing or partial

| Claimed in                                       | Reality |
|--------------------------------------------------|---------|
| ADR 0001: "fire-and-forget tx record … must not break the response if registry is down" | Implemented for provider; dataset-seller and market-monitor implement it inline (D-6) without retries or local queue. A registry outage during a paid flow loses tx records permanently. |
| ADR 0008: "actual file lives on disk (configured via env)" (real mode)         | Not implemented; fixture serves in both modes (C-3). |
| ADR 0010: silent re-review sampling                 | Not implemented (C-4). |
| ADR 0010: buyer-side fraud slashing                 | Not implemented (build-summary §6.4 admits). |
| ADR 0010: "a passing review (rollup ≥3) flips a per-service 'peer-reviewed' badge" | Implemented as **per-seller** badge, not per-service (`sellerBadges()` aggregates across all of a seller's services). |
| ADR 0005: Real-mode subscribe deposit via L402      | Not implemented (build-summary §3 admits "trust-deposit"). |
| ADR 0005: Cancel-refund in real mode                | Not implemented (build-summary §7 admits). |
| ADR 0008: Two-step Lightning settlement to platform | Counter only; no NWC payout (build-summary §6 admits). |
| README "MCP control plane … `/events` (SSE)"         | Listed in `docs/BUILD-SUMMARY.md` endpoint table but not exercised by `test-phase3.js`. Could be a stub. |

### 2.3 Test-script coverage gaps per phase

| Phase | Stated deliverable | Test verifies? |
|-------|-------------------|----------------|
| 1 (registry) | Multi-seller catalog, signed writes, tx ledger | YES — but does not verify rejection of seller spoofing the buyer_pubkey field on `/transactions/record` |
| 2 (subscriptions) | Polling delivery, sat-per-event, top-up, cancel, balance_exhausted, signed alerts | Mostly YES — but "alert delivery is signed by the seller (HMAC over the alert body)" (ADR 0005) is checked only by `length >= 40`, not by re-computing the HMAC |
| 3 (control plane) | Headless control plane, kill-switch, deferred GUI | YES — but `/events` SSE endpoint listed in build-summary is not exercised |
| 4 (orchestrator) | Embeddings, ranking 60/20/20, explainable | YES |
| 5 (peer review) | Honor, blind assignment, slashing, decay, peer_reviewed badge | PARTIAL — peer_reviewed badge assertion has a fall-through "skipped — known limitation" branch (test-phase5.js:208) that lets the test pass without ever confirming the badge appears |
| 5 | "blind assignment" | NOT verified blind — the test confirms reviewer ≠ requester pubkey; it does not test that the reviewer cannot derive the subject pubkey |
| 5 | "tx within 30 days" gate on rate | YES (positive case only — not tested with a >30-day-old or absent tx) |
| 5 | Slashing requires verifiable evidence | NO — test passes with `evidence: { test: true }` and `reason: "fraudulent ratings (test)"` |
| 6 (dataset) | Platform fee = 2%, signed URL 24h | YES for fee; signed URL exp is reported but not validated against tampering |

---

## 3. Money-flow traces

### 3.1 Single L402 listing-verify call (240 sat)

```
buyer_wallet ── 240 sat (Lightning) ──► provider_wallet
                                          │
                              (settled preimage)
                                          │
                              fire-and-forget HTTP POST
                                          ▼
                            registry: transactions.record
                                  amount_sats=240
                                  platform_fee_sats=5  (rounded 2%)
                            (NO money moves to platform — counter only)
```

**Hops where money could be lost / double-counted:**

- L1. Macaroon issued before settlement check; in mock the preimage is
  deterministic; in real, `verifyAuth` calls `lookupInvoice`. If the wallet
  reports `settled=true` but the bolt-11 was paid by someone other than
  the L402 caller, the holder of the macaroon+preimage is granted access —
  L402 doesn't bind invoice payer to macaroon holder. **Lost integrity,
  not lost sats.**
- L2. `recordTxFireAndForget` uses `txId = "tx_" + payment_hash[:24]`
  truncated. Collisions across providers possible (same payment_hash
  prefix on two settled invoices). `payment_hash UNIQUE` constraint will
  reject the second; **fee on second is silently dropped from the ledger.**
- L3. `platform_fee_sats` is set by the **seller** in the signed tx
  record. The seller can set it to 0 with no consequence — the registry
  doesn't recompute it server-side (`recordTransaction` honors whatever
  the seller posts, defaulting to 0). **Platform revenue is on the honor
  system.**
- L4. No two-step settlement: the platform never receives sats. The 2%
  is a fictional accounting line until ADR 0008 §"Two-step settlement"
  is implemented. The seller keeps 100% of the gross.

### 3.2 Dataset purchase with peer review (5000 sat)

```
buyer_wallet ── 5000 sat ──► dataset_seller_wallet     (L402 settle)
                                  │
                       fire-and-forget tx record
                                  ▼
                         registry: amount_sats=5000
                                   platform_fee=100  (counter only)

[later, seller requests peer review]
seller (escrow_sats=N) ──► review_requests row (escrow held in registry)
                                  │
                  blind-assigned reviewer submits rubric
                                  ▼
                 reviewer.owed += N * 0.95   (LEDGER ENTRY ONLY)
                 platform.owed += N * 0.05   (LEDGER ENTRY ONLY)
                 seller.honor  += rollup * 2

[NB: escrow_sats is a number on the row; no Lightning payment was actually
 collected. The "escrow" is purely declarative.]
```

**Loss / double-count surfaces:**

- D1. **Escrow is fictitious in v0.** `requestReview` accepts any
  `escrow_sats` integer with no payment proof. The seller can claim 1
  satoshi and the reviewer "earns" 95% of nothing; or claim 1B and inflate
  the platform-fee counter. There is no validation. **The economic claim
  fails the moat test — see §6.**
- D2. **Reviewer payout is never paid.** `submitReview` returns
  `reviewer_payout_sats` in the JSON response, but no DB column tracks
  reviewer balances. There is no `reviewer_owed` table. The reviewer has
  no way to claim sats. **Money "credited" goes nowhere.**
- D3. **Slashing escrow clawback is also fictitious.** `slashReviewer`
  returns `escrow_returned: req.escrow_sats` in the response but does not
  actually update any balance row, does not refund any Lightning invoice.
  ADR 0010 admits this in mock mode but the test asserts the number, not
  the payment — false sense of completeness.
- D4. **Buyer's `rate_seller` honor delta has no escrow at all** — it
  ships free of payment, so honor inflation by a single buyer who pays
  240 sat once and rates 5★ repeatedly is bounded only by the "30 day"
  cooldown (which is per-call, not per-month). The 30-day check accepts
  any tx; nothing prevents `rateSeller` from being called once per second
  with the same buyer-seller pair. **`UPDATE sellers SET honor = honor +
  ?` has no per-buyer-per-seller uniqueness.** Honor is unbounded.

### 3.3 Paid verification request (review escrow flow)

```
seller ─── signed POST /reviews/request {escrow_sats: N} ───► registry
                                                                │
                                       (no money. just a row.)
                                                                ▼
                                              random reviewer assigned
```

There is no Lightning hop. ADR 0010 §"Escrow + platform cut" admits *"in
v0 mock mode this is a counter only."* Any economic claim about reviewer
honesty incentives (D2, D3) is therefore decorative until a future
"settlement layer" is built. The audit log entry is HMAC-signed with a
default secret string (D-4) that is committed to the codebase as the
fallback — **on a default deployment the slashing audit log is not
cryptographically meaningful.**

---

## 4. Trust model matrix

| Privileged action            | Triggered by       | Verification             | Publicly auditable? |
|------------------------------|--------------------|--------------------------|---------------------|
| Seller registration / upsert | Seller             | Ed25519 sig, 5-min ts    | YES (`GET /sellers`) |
| Service catalog write        | Seller (signed)    | Ed25519 sig              | YES |
| Tx record                    | Seller (signed)    | Sig matches `seller_pubkey` only — buyer field is unverified | PARTIAL — buyer_pubkey is unauthenticated |
| `platform_fee_sats` value    | Seller (signed)    | NONE (server trusts the number) | NO — fee can be 0; no recomputation |
| Buyer rating (`/rate`)       | Buyer (signed)     | Verifies a tx exists in last 30d, but not that this is the first rating, and not the integrity of the underlying tx (D-1) | PARTIAL |
| Review request               | Seller (signed)    | Sig only — no escrow proof of payment | NO |
| Reviewer availability        | Reviewer (signed)  | Ed25519 sig              | YES (joined view) |
| Review submission            | Reviewer (signed)  | Sig + rubric validation  | YES |
| Slashing / dispute           | **Anyone with a valid Ed25519 keypair** | Sig only; no buyer-of-record check, no silent re-review | YES (event row) but evidence is whatever the disputer posts; HMAC uses a default secret if env unset (D-4) |
| Honor decay                  | Lazy on `GET /sellers/:pubkey` OR admin-secret POST | None server-side beyond `decay_runs` self-coordination | YES (decay_runs row) |
| Reviewer assignment (random) | Seller's `request_review` triggers it | Server picks weighted-random; client is told the outcome — **no commit-reveal**, **no transcript** | NO — the registry could secretly always pick the requester's chosen reviewer; nothing publishes the random seed |
| Honor delta per rating       | Buyer | None — unlimited per buyer-seller pair (no UNIQUE index) | NO |
| Admin endpoints (decay, fast-forward, revenue) | Holder of `ADMIN_SECRET` (default `"dev-admin-secret"`) | Plain header check | NO — no audit log; no rate-limit; default secret is documented |

**Privileged actions the registry can do that are not publicly auditable:**

- **A1.** Pick a non-random reviewer (no commit-reveal of randomness).
- **A2.** Mutate `sellers.honor` directly via SQL bypass (no append-only
  honor log; the only audit log is `slashing_events`, and that's only
  written by the `slashReviewer` path).
- **A3.** Drop tx records (`recordTransaction` is `INSERT OR IGNORE`;
  nothing publishes a Merkle root or signed snapshot).
- **A4.** Edit any field of any row (single SQLite file).
- **A5.** Run `forceRunDecay()` arbitrarily often (idempotent within 24h
  is **only** enforced through `maybeRunDecay`; `forceRunDecay` has no
  cooldown and is reachable via `POST /admin/decay?force=1`).

---

## 5. Cold-start risk register

| Feature                               | Liquidity required  | N=0 / N=1 behavior |
|---------------------------------------|---------------------|-------------------|
| Orchestrator `recommend`              | ≥1 service          | N=0: returns empty `results`. N=1: still ranks, max_honor=1 forced; `intent_match` dominates trivially. Acceptable. |
| Search (`/services/search`)           | ≥1 service          | N=0: empty list. OK. |
| Honor ranking                         | ≥1 honor signal     | All sellers start at 0 → `maxHonor = max(1, ...)` returns 1 → `honor_normalized` is identically 0 for every seller until someone gets rated. Effectively dead weight in v0 (the 20% honor factor is meaningless on a fresh registry). |
| Peer review                           | ≥1 reviewer ≠ requester | N=0 reviewers: `requestReview` returns `{ ok:false, reason:"no reviewers available" }`. N=1 (=requester): same. N=2 with weighted-random: blind in name only (only one option). The "weighted random" is meaningless at N=2. |
| Buyer rating (`/sellers/:pubkey/rate`)| ≥1 prior tx (30d)   | N=0 tx: 403 `"no transaction with this seller in the last 30 days"`. Cold-start pathological — first-week sellers have no ratings until they cycle. |
| Subscriptions                         | ≥1 subscriber + watcher | N=0 subscribers: watcher loop ticks for nothing. Real-mode: GitHub API rate-limited; no auth header set in `fetchRealAdvisories`. |
| Dataset marketplace                   | ≥1 dataset          | One dataset is shipped; no second seller exists; no ranking signal between datasets. |
| Slashing / dispute                    | Any reviewer to slash | N=0 unprocessed reviews: 404. Dispute path unauthenticated for buyer-of-record (anyone signed can dispute), so this lights up before liquidity does — wrong cold-start signal. |
| Platform-fee revenue                  | ≥1 settled tx       | Counter only; no payout pipe; no liquidity needed because no money flows. |

**Concentrated risks at N≈1:**

- C-1. **Single seller per type → orchestrator collapses to "the only
  option."** The 60/20/20 ranking is theatrical at N=1.
- C-2. **Single reviewer → blind assignment is predictable.** With one
  reviewer in the pool, every request lands on them. `pickRandomReviewer`
  is honest about it but the design pretends randomness is a property.
- C-3. **First buyer can't rate first seller** without a prior tx; first
  tx cannot be rated (the rating is per-tx in concept but per-seller in
  schema). Bootstrapping reputation requires an off-system trust bridge.

---

## 6. Moat-test results per seller type

The audit prompt references a "make-vs-buy-vs-spawn" framework. **No
documented framework exists in `docs/decisions/`**, in the README, or in
the CHANGELOG. I infer the prompt's intent: each agent-built seller should
sell something a buyer agent could not trivially do itself or buy
elsewhere. I evaluate against that inferred standard.

| Seller            | Sells                                | "Make-it-yourself" cost | "Buy from existing API" alternative | Moat as built |
|-------------------|--------------------------------------|--------------------------|--------------------------------------|---------------|
| `vision-oracle-3` (provider) | OSM-geocoded listing verification + signed receipt | OSM Nominatim is free, ~1 line of code | Direct Nominatim usage | **WEAK.** The signed proof + L402 demonstration is the moat (no Nominatim caller signs). 240 sat for what is effectively a free API call wrapped in a signature is justifiable as "trust amortization", not as data scarcity. |
| `market-monitor` (advisory subscriptions) | GHSA advisories with debounced delivery + filter config | GitHub publishes advisories.json for free; `fetchRealAdvisories` literally calls the public endpoint | Direct GitHub API + cron | **VERY WEAK as built.** The fixture mode dominates the test surface; real-mode `fetchRealAdvisories` does not authenticate (60 req/h public limit), no ETag caching, no value-add beyond "we already wrote the cron." The seller's moat reduces to "the buyer doesn't want to run a watcher loop." |
| `dataset-seller` (NOAA PNW 2015-25) | A specific historical weather archive | NOAA itself publishes the underlying data for free via opendata.aws + NCEI | Wget + S3 cli | **MOAT-IS-PROVENANCE.** The ADR claims provenance + curated rows + signed-URL delivery. As implemented: a 20 KB JSON fixture, no signing of the *contents*, no provenance attestation beyond a `source` string. The moat the ADR promises is not the moat the code delivers. |
| Reviewer (peer review) | Independent rubric assessment + slashing-backed honesty | Hire any human or LLM judge | Trust-as-a-service is novel; no obvious off-the-shelf | **WEAK.** Slashing is the moat — but slashing is fictitious money (D2/D3) on a default-secret HMAC log (D-4). At v0 the moat is honor points with no economic teeth. |

**Drift summary:**

- Provider: **moat held**, but only because the demo intent is the L402
  protocol itself, not the data.
- Market-monitor: **moat eroded.** The cost the seller saves the buyer is
  cron + filter config — easily replicated.
- Dataset: **moat promised, not delivered.** Real-mode parquet, signed
  contents, and provenance proofs would deliver it; the JSON fixture does
  not.
- Reviewer: **moat depends on a settlement layer that doesn't exist.**

---

## 7. Top 5 design concerns (ranked by severity)

### S1 — CRITICAL · Honor system is unbounded and trivially gamed

`POST /sellers/:pubkey/rate` has no per-buyer-per-seller uniqueness
constraint. Any buyer with one ≥1-sat tx in the last 30 days can call
`rate(stars=5)` an unbounded number of times. `UPDATE sellers SET honor =
honor + ?` runs every call. A single-tx attacker can move any seller's
honor by ±2 per request. This is the highest-severity finding because
honor is the input to (a) the orchestrator's 20% ranking weight and (b)
reviewer weighting in `pickRandomReviewer`. Game one rating loop, win the
review queue.

### S2 — CRITICAL · Review economics are decorative

ADR 0010's escrow + platform cut + reviewer payout + slashing are all
counter-only. No `reviewer_owed` ledger, no Lightning payouts, no escrow
collection. The slashing audit log is HMAC-signed with a string committed
to the source as a default fallback. A buyer agent depending on
"peer-reviewed = trustworthy" is depending on a number with no
cryptographic or economic backing in v0. The honest scope (build-summary
§4–6) admits this; the public docs (PAYMYAGENT.md, README) do not.

### S3 — HIGH · Buyer attribution on tx records is unauthenticated

`recordTransaction` accepts a `buyer_pubkey` field signed by the seller.
The seller can write any pubkey; nothing on the buyer side ever signs.
This breaks: (a) the rate-seller "tx within 30 days" check (sellers can
fabricate tx history for shill buyers), (b) per-buyer analytics, (c) any
future tx-based privilege (e.g. "must have spent N sats with this seller"
gating). The fix would require buyer-side signed attestations on settle —
not in scope today, but the design does not call this out.

### S4 — HIGH · "Blind" reviewer assignment is not blind, and "random" is unverifiable

The reviewer trivially derives the subject pubkey from `subject_pubkey`
on the assignment row (returned by `/reviews/assigned`). The randomness
of the pick is unverifiable — no commit-reveal, no on-chain seed, no
published `last_assigned_at` audit. The registry is a trusted oracle for
the entire reviewer-fairness story. ADR 0010 markets this as if it were
a primitive; it is policy-by-server-code.

### S5 — HIGH · Two-step platform fee is sold as a feature, exists as a counter

ADR 0008 and the PayMyAgent narrative invoke the 2% platform fee as
infrastructure. The implementation is `platform_fee_sats = round(amt *
0.02)` written into a SQLite column by the seller, with no payout. The
"platform" never receives sats; the seller keeps 100% of gross. A future
auditor or partner reading the ADR will assume revenue is collected; it
isn't.

---

## Appendix · Files inspected

- `README.md`, `PAYMYAGENT.md`, `CHANGELOG.md`
- `docs/decisions/0001..0010-*.md`, `docs/BUILD-SUMMARY.md`
- `registry/migrations/0001-initial.sql`, `0002-honor-decay.sql`
- `registry/src/lib/db.ts`, `registry/src/lib/reviews.ts`,
  `registry/src/lib/sig.ts`, `registry/src/lib/embeddings.ts`
- `registry/src/app/api/v1/transactions/record/route.ts`
- `registry/src/app/api/v1/sellers/register/route.ts`
- `registry/src/app/api/v1/sellers/[pubkey]/route.ts`
- `registry/src/app/api/v1/sellers/[pubkey]/rate/route.ts`
- `registry/src/app/api/v1/reviews/request/route.ts`
- `registry/src/app/api/v1/reviews/[id]/submit/route.ts`
- `registry/src/app/api/v1/reviews/[id]/dispute/route.ts`
- `registry/src/app/api/v1/reviewers/availability/route.ts`
- `registry/src/app/api/v1/orchestrator/recommend/route.ts`
- `registry/src/app/api/v1/admin/decay/route.ts`,
  `…/admin/fast-forward/route.ts`, `…/platform/revenue/route.ts`
- `provider/src/lib/registry-client.ts`
- `agents/market-monitor/src/server.js`,
  `agents/dataset-seller/src/server.js`
- `mcp/server.js`
- `packages/andromeda-core/src/signed-request.ts`,
  `packages/andromeda-core/src/index.ts`
- `scripts/test-phase{0,1b,2,3,4,5,6}.js`

No code was modified. No tests were run.
