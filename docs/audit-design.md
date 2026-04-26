# Agora — design audit (post-MDK migration, ADR 0014)

> Independent paper review. No code changes; no tests run. Reviewer
> approached fresh, reading `README.md`, `PAYMYAGENT.md`, ADRs
> 0001–0014, `docs/BUILD-SUMMARY.md`, `DEPLOY.md`, then a targeted
> source scan. This audit overwrites the previous (post-rebrand)
> design audit. It centres on:
>
> 1. ADR 0014 (L402 → MDK wire format) coherence and timeline.
> 2. The activity-feed PR (`5aacd66`) and its leakage surface.
> 3. The deploy commit (`d64ebcf`) — admin hardening completeness.
> 4. Whether ADR 0013 triple-aliasing has narrowed under MDK.
> 5. Status of the previous audit's top-5 design concerns.

Working directory `C:\Projects\lumen`. All file paths in this report
are absolute.

---

## 0. Verdicts at a glance

| Item | Verdict |
|---|---|
| Previous Top-5 status | 0 of 5 addressed in code; 1 partially mitigated by deprecation framing; the rest unchanged or shifted. |
| MDK migration (ADR 0014) | **Stopgap: the wire format is MDK-compatible, but no MDK code is on any execution path; "real mode" still uses the in-house mint and an offline shim. Hybrid story creates net-new technical debt.** |
| Deploy hardening (`d64ebcf`) admin secret | **Clean fix** for the previous P1 default (`dev-admin-secret`) — the fallback string is gone from all three call sites; new helper fails closed (503) when env unset. |
| Activity feed (`5aacd66`) | New public exposure surface. Counterparty graph + per-tx `payment_hash` prefix now public, uncached for ≥2 s. |
| Triple-aliasing (ADR 0013) | Not narrowed by ADR 0014; still widened. The L402 wrapper now adds a fourth shape (legacy-macaroon soft-transition path). |

---

## 1. Coherence findings

### 1.1 ADR-vs-ADR contradictions

**C-1 (was, still). "No accounts, no email" vs. registry pubkey upsert.**
ADR 0001 frames Agora as account-free; ADR 0004 + the schema make the
Ed25519 pubkey *the* account (PRIMARY KEY in `sellers`, signed upsert
write-protection). The rhetorical contradiction is unchanged. ADR 0014
did not amend the framing.

**C-2 (was, still). "Blind" reviewer assignment is not blind.**
`C:\Projects\lumen\registry\src\lib\reviews.ts::pickRandomReviewer`
returns the row with `subject_pubkey` to the reviewer via
`getReviewerAssignments` (the `SELECT … subject_pubkey …` at lines
38–46). The reviewer trivially derives the seller. No commit-reveal,
no `seed` column, no transcript. ADR 0010 still markets this as a
primitive.

**C-3 (was, still). Real-mode dataset path doesn't exist.**
`agents/dataset-seller/src/server.js` still serves a JSON fixture
unconditionally. ADR 0008's "actual file lives on disk (configured via
env)" remains vapor. README §"Known limitations" calls out
`agora_purchase_dataset` "not implemented in MCP real mode" but does
not own the deeper claim that no file delivery exists at all.

**C-4 (was, still). Dispute path slashes on the disputer's say-so.**
`C:\Projects\lumen\registry\src\app\api\v1\reviews\[id]\dispute\route.ts`
calls `slashReviewer` with `evidence: json.evidence ?? {}` and never
verifies (a) the disputer is a buyer-of-record, (b) the evidence is
well-formed, (c) silent re-review deviation. ADR 0010
§"Two-sided slashing" is unimplemented as written.

**C-5 (was, still). Tx record is seller-signed; buyer field is unsigned.**
`C:\Projects\lumen\registry\src\app\api\v1\transactions\record\route.ts`
verifies only `auth.pubkey === seller_pubkey` (line 30); `buyer_pubkey`
is whatever the seller posts. Concern #3 from the prior audit holds
verbatim.

**C-6 (was, still). Three-header-family acceptance is untrue for the
registry's signed-write gate.**
`C:\Projects\lumen\registry\src\lib\sig.ts` lines 16–18 short-circuit
401 ("missing signature headers") if the canonical `x-agora-*` triplet
is absent — *before* `@agora/core::verifyRequest`'s multi-family
walker is consulted. Buyers signing `x-andromeda-*` or `x-lumen-*`
hit the early-return. The phase-1b regression test asserts only the
status code, not the reason string, so the test passes despite
mis-implementation. Unchanged by ADR 0014; the L402 layer's
"three-shape" promise inherits the same trust-but-don't-verify
posture (see C-12 below).

**C-7 (was, still). Dashboard kill-switch isn't enforced on registry
proxy endpoints.**
ADR 0011 §3 third-bullet asserts a future-work integration that has
not landed. The audit-behavior report agrees.

**C-8 (was, still). Web index trusts registry headers; SSR pages can
desync silently.**
`web/` is `revalidate = 0` in the activity page but ISR-cached
elsewhere; cache invalidation on registry mutation is not specified
anywhere.

**C-9 (NEW, ADR 0014). The "MDK migration" doesn't migrate to MDK.**
ADR 0014 §"Decision" promises that real-mode runs through
`@moneydevkit/nextjs/server.withPayment` end-to-end; `provider/` does
not import `@moneydevkit/*` at all. Grep across the repo's source
shows zero `withPayment`, `moneydevkit`, or `MDK_ACCESS_TOKEN` symbols
in any executed file. The provider's real-mode path is identical to
the mock-mode path: `mintMacaroon(...)` from
`packages/agora-core/src/l402.ts`, signed with `L402_SECRET` (NOT
`MDK_ACCESS_TOKEN`), invoiced via the in-house wallet adapter. The
README §"Path B" admits this in passing: *"The provider continues to
use its own L402 wrapper today. The full
`@moneydevkit/nextjs/server.withPayment` adoption is the documented
next step in ADR 0014 §Migration timeline."* That is a fair
disclosure; what makes it incoherent is that ADR 0014's main decision
table claims real-mode goes through MDK end-to-end *now*. The two
documents disagree.

**C-10 (NEW, ADR 0014). The "byte-identical to MDK" claim is
unverifiable in this repo.**
`packages/agora-core/src/l402.ts::mintMacaroon` re-implements MDK's
HMAC scheme (`KEY_DERIVATION_TAG = "mdk402-token-v1"`, the JSON shape
with `paymentHash/amountSats/expiresAt/resource/amount/currency/sig`,
the `\0`-joined sig pre-image). There is no test against a real
MDK-issued credential; the byte-identity claim is asserted by ADR
0014 §"Decision" but not pinned by any fixture. If MDK changes its
internal token format (no SemVer guarantee on a
`@moneydevkit/core/dist/mdk402/token.js` private export), the offline
shim drifts silently. The shim is functionally an in-house format
that *resembles* MDK's, not a tested MDK compatibility layer.

**C-11 (NEW, ADR 0014). Migration timeline is unspecified.**
ADR 0014 §"Migration timeline" reads *"One major-version bump from
now: drop the legacy verifier."* No major-version is defined for this
repo (the root package is `lumen` and ships nothing); no version exists
at the workspace level either. The "deprecation cycle" is rhetorical.
Compare to ADR 0013, which has the same problem. Two stacked
deprecation cycles ride on a non-versioned package.

**C-12 (NEW, ADR 0014). Soft-transition verifier widens the
acceptable-credential surface.**
`verifyAuth` first attempts MDK-shape, then falls back to legacy
`base64url(json).hmac`. Both formats use the same `L402_SECRET`. The
legacy verifier (`verifyMacaroonLegacy` lines 200–221) does NOT
key-derive — it HMACs the payload directly with the raw secret. So the
*same* secret is used to authorise two distinct token formats with two
distinct signing constructions. There is no negative test that a
forged MDK-shape credential containing arbitrary `paymentHash` cannot
be rewritten as a legacy-shape credential and accepted; the verifiers
are independent code paths with independent attacker surfaces. This
is not a known break, but it is a widening of the cryptographic
boundary that the old single-format verifier did not have.

**C-13 (NEW, ADR 0014). Mock-mode HMAC keying disagrees with MDK's KDF
purpose.**
ADR 0014 §"Seller secret" says: *"`MDK_ACCESS_TOKEN` for real
Lightning, `L402_SECRET` for mock-mode HMAC seed. We do NOT
cross-wire them."* But mock-mode mints feed `L402_SECRET` into
`deriveKey(secret) = HMAC(secret, "mdk402-token-v1")` — the very KDF
tag MDK uses to domain-separate `MDK_ACCESS_TOKEN` from its other
keys. Reusing the tag with a different upstream secret is harmless in
isolation (the tag is just a label) but defeats the domain separation
MDK chose. If a deployment ever cross-wires the two by accident — set
`L402_SECRET = MDK_ACCESS_TOKEN` to "test before flipping
`MOCK_MODE`" — the two systems become forge-equivalent. This isn't a
break; it's a footgun the ADR explicitly creates by reusing MDK's
internal constant.

### 1.2 Code decisions not in any ADR

**U-1 (was, still). Honor write paths are not all in one ADR.**
Honor is mutated in `rateSeller`, `submitReview`, `slashReviewer`, and
`maybeRunDecay`. ADR 0010 covers reviews + decay; the buyer-rating
write path is not described anywhere — it's invented in
`registry/src/lib/reviews.ts::rateSeller`.

**U-2 (was, still). Platform fee is a counter, not a payout.**
ADR 0008 promises a "two-step settlement to a platform NWC". The code
records `platform_fee_sats` on each tx and exposes a `/v1/platform/revenue`
admin GET (now properly admin-gated, see §3) but never makes a
payment. README §"Known limitations" admits this. Concern #5 from
the prior audit is unaddressed.

**U-3 (NEW). The activity feed is undescribed in any ADR.**
`registry/src/app/api/v1/transactions/recent/route.ts` (37 lines,
public, uncached past the 2 s s-maxage), `web/src/app/activity/page.tsx`
(101 lines, SSR + force-dynamic) — neither lives in ADR 0012 (which
froze the web index at 7 pages: `/`, `/sellers`, `/sellers/:pubkey`,
`/services`, `/services/:id`, `/search`, `/recommend`). The PR adds
an 8th page (`/activity`) and a new public registry endpoint without
an ADR. The schema name in the response (`agora.transactions.v1`) is
a wire-format commitment that no ADR lists.

**U-4 (NEW). The deploy contract isn't an ADR either.**
`DEPLOY.md` and `d64ebcf` introduce a Fly.io single-instance contract
("registry must stay at exactly one machine because of SQLite") and a
specific failure mode for breach (data corruption). This is a
load-bearing operational invariant that ADR 0004 (registry design)
predicted ("SQLite, one writer") but never bound to a deploy
topology. The single-instance constraint is now in the runtime
trust model and should be in an ADR.

### 1.3 Architecture-vs-reality drift

**D-1 (was, still). Mock and real diverge on idempotency authority.**
ADR 0014 says real mode delegates idempotency to MDK's backend;
mock mode keeps the seller's SQLite invoices table. In actual code
(C-9 above) real mode also uses the SQLite table because `withPayment`
is never called. So the divergence the ADR predicts hasn't happened
yet — which means the ADR is describing a *future* architecture, not
the deployed one. Documentation lag.

**D-2 (was, still). Buyer-side claims invariant under MDK.**
PAYMYAGENT.md is correct that the buyer is unchanged: it never sees
the macaroon's structure. This claim survives the migration
unchanged.

**D-3 (NEW). README mock-mode claim is precise; ADR 0014 mock-mode
claim is over-strong.**
README: *"Mock mode is the default everywhere — fake invoices,
deterministic preimages, zero sats moved."* ADR 0014 §"Decision":
*"Offline shim mints / verifies MDK-shape macaroons byte-for-byte"*.
The README claim is true; the ADR claim is unprovable in the repo
(C-10).

---

## 2. Spec gaps

| ID | Gap | Severity |
|---|---|---|
| S-1 | `rateSeller` accepts unbounded repeats per (buyer, seller). No `UNIQUE(buyer_pubkey, seller_pubkey)` constraint, no last-rating overwrite, no rate-limit. One tx + N rate calls = ±5N honor. | CRITICAL — UNCHANGED |
| S-2 | `recordTransaction` `buyer_pubkey` is seller-asserted. Combined with S-1, sybil-rate of any seller by a colluding seller is one HTTP call away. | HIGH — UNCHANGED |
| S-3 | `pickRandomReviewer` uses `Math.random()` (line 21 of reviews.ts) — non-VRF, server-decided, unverifiable. ADR 0010's "blind random" cannot be audited by anyone except whoever runs the registry. | HIGH — UNCHANGED |
| S-4 | Escrow / slashing payouts are counters; no Lightning leg. Same as #2 of the prior audit. | CRITICAL — UNCHANGED |
| S-5 | Platform fee is a counter; same as #5 of prior audit. | HIGH — UNCHANGED |
| S-6 | (NEW) `transactions/recent` returns full `buyer_pubkey`, full `seller_pubkey`, `payment_hash`, `service_id`, `amount_sats`, `settled_at` — public. Counterparty graph and full payment-hash prefix (8 chars displayed; full 64 in JSON) is enumerable. | MEDIUM (privacy) — NEW |
| S-7 | (NEW) ADR 0014 names but does not bind a deprecation date for legacy macaroons. ADR 0013 has the same problem. Two compounding open-ended deprecations. | MEDIUM — NEW |
| S-8 | (NEW) No fixture asserts "MDK-shape macaroon minted by Agora is accepted by MDK". The byte-identity claim is untested. | MEDIUM — NEW |

---

## 3. Money-flow traces

### Trace A — Provider listing-verify, 240 sat (real mode, ADR 0014)

```
Buyer (NWC)                 Provider (Next.js, port 3000)             Registry (port 3030)
   │
   │ POST /v1/listing-verify (no auth)
   ├─────────────────────────►
   │                          │ 1. require402 → wallet().makeInvoice()
   │                          │    [in-house wallet, NOT @moneydevkit]
   │                          │ 2. mintMacaroon({...}, L402_SECRET)
   │                          │    [agora-core mint — MDK *shape* but
   │                          │    keyed off L402_SECRET, NOT
   │                          │    MDK_ACCESS_TOKEN]
   │                          │ 3. recordInvoice(SQLite, status='pending')
   │   402 + WWW-Authenticate │
   │◄─────────────────────────┤
   │
   │ NWC pay(invoice) → preimage          (sats land in seller wallet,
   │                                       NOT in MDK custody)
   │
   │ POST /v1/listing-verify
   │   Authorization: L402 <macaroon>:<preimage>
   ├─────────────────────────►
   │                          │ 4. verifyAuth: try MDK-shape verify;
   │                          │    if fail, fallback to legacy verify
   │                          │    (both with L402_SECRET) [C-12]
   │                          │ 5. markInvoiceConsumed (SQLite)
   │                          │ 6. handler runs
   │                          │
   │                          │  POST /v1/transactions/record
   │                          │  signed by SELLER, buyer_pubkey free-form [S-2]
   │                          ├──────────────────────────────────────────►
   │                          │                                           │
   │   200 + body             │                                           ▼
   │◄─────────────────────────┤                                       Tx ledger
   │                                                                   • visible on
   │                                                                     /api/v1/transactions/recent
   │                                                                     (PUBLIC) [S-6]
```

Annotations:
- **None of this traffic touches `mainnet.moneydevkit.com`.** ADR 0014
  §"Decision" says it does in real mode; the code says it does not.
- **Platform fee** is recorded on the tx row (`platform_fee_sats`)
  but no payment leg is made; no NWC handle to a "platform wallet"
  exists in any code path.

### Trace B — Honor manipulation under S-1 + S-2

```
Colluding seller K
    │
    │ 1. POST /v1/transactions/record signed by K
    │    body: { buyer_pubkey: <pubkey K_buyer>, seller_pubkey: <pubkey M>,
    │            service_id: ..., amount_sats: 1, payment_hash: <random hex> }
    │    [S-2: buyer_pubkey accepted at face value]
    ▼
  Registry tx ledger ← row inserted (tx with K_buyer "purchasing" from M)
    │
    │ 2. POST /v1/sellers/M/rate signed by K_buyer
    │    body: { stars: 5 }
    │    [passes the 30-day tx gate because step 1 just made one]
    ▼
  Registry: M.honor += 2

  REPEAT step 2 → S-1: rateSeller has no UNIQUE, no overwrite, no
  rate-limit. Each call adds 2. Hundred calls = +200 honor. Same buyer
  pubkey, same seller, same code path, no detection.
```

Cost to attacker: 0 sats (the recorded tx need not have a real
preimage — `payment_hash` is a free-form string the registry never
verifies). One Ed25519 keypair (K_buyer) can be created in microseconds.
This trace is unchanged from the prior audit; it is the central
unaddressed Top-1 concern.

### Trace C — Activity feed leakage (NEW)

```
Anonymous client
    │
    │ GET /api/v1/transactions/recent?limit=200
    ▼
  Public response (cache: 2 s):
   [
     { buyer_pubkey, seller_pubkey, service_id, amount_sats,
       platform_fee_sats, payment_hash, settled_at }, ... × 200
   ]
```

What is leaked that aggregate `/sellers/:pubkey/stats` did NOT leak:
- Which buyers transact with which sellers (bipartite graph).
- Per-tx amounts (existing per-seller stats give totals, not
  individual rows).
- `payment_hash` per tx — public; combined with a real-mode wallet's
  on-chain visibility, may correlate to specific paid invoices.
- Tx timing — useful for activity-fingerprinting low-volume sellers.

For a low-volume seller (1–5 txs/day), the buyer set is enumerable
within a few crawls.

---

## 4. Trust model matrix

| Actor | Trusted to | NOT trusted to | Verified by |
|---|---|---|---|
| Buyer (MCP/NWC) | Pay invoices; submit reviews truthfully | Read other buyers' tx | NWC wallet boundary |
| Seller | Mint own L402 macaroons; record own txs | Self-attest buyer pubkey | Ed25519 sig on `transactions/record` (S-2: only seller side checked) |
| Registry | Honest tally, decay schedule, reviewer pick | Non-collusion with sellers | None (single SQLite, single operator) |
| Reviewer | Submit honest scores | Hide subject from themselves (see C-2) | Honor + slashing (slashing path is C-4) |
| Platform | Sum and *receive* fees | (counter only — no real receipt) | none — counter math only |
| **MDK (NEW)** | (real mode, per ADR) Hosted node, channels, idempotency, credential redemption | (in code) — MDK never reached at runtime | None — `withPayment` import absent |
| Activity-feed reader (NEW) | Read public ledger | Privacy of buyer/seller graph | None — public uncached endpoint |
| Fly.io operator (NEW) | Host the SQLite volume; preserve `--ha=false` invariant; rotate `ADMIN_SECRET` | (cannot be enforced from app) | Operational discipline only |

---

## 5. Cold-start risk register

| Risk | Status |
|---|---|
| No reviewers on first registration → `requestReview` returns "no reviewers available" → seller can never accumulate honor through the peer-review path. | UNCHANGED |
| First buyer cannot rate without a tx; first tx requires a buyer — chicken-and-egg eased only by the seller's own `transactions/record` (which S-2 lets them spoof). | UNCHANGED |
| Activity feed shows `0` until the first paid call lands, then leaks the very first buyer/seller pair — privacy of the early adopters is poor. | NEW |
| MDK real-mode boot requires three secrets (`MDK_ACCESS_TOKEN`, `MDK_MNEMONIC`, NWC). Any one missing → silent fall-back to in-house mint with the same wire format. The deploy contract makes no claim about this; an operator who *thinks* they are on MDK may be on the in-house shim. | NEW |
| Fly registry first-deploy: `ADMIN_SECRET` is `--stage`d and must be deployed; missing it returns 503 on every admin endpoint. Fail-secure but loud. | NEW (bounded — admin endpoints fail closed) |

---

## 6. Moat-test results per seller type

(Question: can a competitor stand up a parallel service and undercut
or outpace this one without a meaningful re-build cost?)

| Seller type | Moat depth | Notes |
|---|---|---|
| Provider (`vision-oracle-3`) | Shallow | OSM-geocoded listing-verify is ~50 lines around Nominatim; no proprietary data. |
| Market-monitor | Shallow | GHSA poller; public feed. |
| Dataset-seller | Vapor | The "dataset" is a JSON fixture; ADR 0008's file-on-disk path is unimplemented (C-3). |
| Registry as a coordinator | Shallow but sticky | Sticky because seller pubkeys self-register and accumulate honor — *but* honor is gameable per S-1+S-2, so the stickiness is illusory. A competing registry could index the same pubkeys and re-derive everything except the colluder-padded honor scores, which is a feature, not a bug. |
| Activity feed (NEW) | Negative moat | The feed is *self-undermining*: a competing registry can scrape `/transactions/recent` from this one and import the entire counterparty graph. No rate limit, no auth, full pubkey visibility. |

---

## 7. Status of previous audit's top-5 concerns

| # | Concern | Status |
|---|---|---|
| 1 | `rateSeller` no per-(buyer,seller) uniqueness — trivially gamed | **STILL** — code unchanged at `registry/src/lib/reviews.ts:49–69`. No UNIQUE index added; no last-write-wins; no rate-limit. |
| 2 | Review economics decorative (escrow/payouts are counters) | **STILL** — `slashReviewer` line 162 comments "(mock: just record. real: trigger NWC payback.)"; no NWC leg exists. |
| 3 | Buyer attribution on tx records unauthenticated | **STILL** — `transactions/record` route line 30 verifies seller only; `buyer_pubkey` is free-form. |
| 4 | "Blind" reviewer assignment isn't blind, "random" isn't verifiable | **STILL** — `getReviewerAssignments` returns `subject_pubkey`; `pickRandomReviewer` uses `Math.random()`. |
| 5 | 2% platform fee is a counter, not a payout | **STILL** — `/v1/platform/revenue` reads the sum from SQLite; nowhere in code does a payment leave the platform's NWC. |

Plus from prior security audit:

**P1 default `dev-admin-secret`** — **CLEAN FIX in `d64ebcf`.** The
fallback string is removed from all three call sites
(`/v1/admin/decay`, `/v1/admin/fast-forward`, `/v1/platform/revenue`).
The new `requireAdmin()` helper at `registry/src/lib/admin.ts:9–22`
fails secure with 503 if `ADMIN_SECRET` is unset or shorter than 16
chars. There is no remaining default and no remaining call site that
bypasses the helper. Verified by `grep`: zero hits for
`dev-admin-secret` in the registry source. This is unambiguously a
**complete fix**, not a relocation.

(Note: the dispute route still calls `slashReviewer` directly without
admin auth — that is a separate, pre-existing issue; C-4. The admin
fix did not extend to disputes.)

---

## 8. MDK migration design verdict

**Verdict: stopgap that creates technical debt.**

Rationale:

1. The wire format moves to MDK shape, but no MDK code is on any
   execution path (C-9). `withPayment`, `@moneydevkit/*` imports,
   `MDK_ACCESS_TOKEN` reads — all absent. The "real mode" the ADR
   describes is not the real mode the code implements.

2. The "offline shim" is now the *only* mode the codebase ships,
   under both `MOCK_MODE=true` and `MOCK_MODE=false`. It re-derives
   MDK's HMAC scheme from a vendored constant (`mdk402-token-v1`)
   without a fixture proving byte-equivalence with a real MDK token
   (C-10). If MDK rotates that constant or changes the field
   ordering — both currently un-versioned private exports — Agora
   silently desynchronises.

3. The soft-transition verifier introduces a second authenticator
   path with the same secret (C-12). Single-secret, two-format,
   independent verifier code — the union of acceptable inputs grows;
   the test gates only assert positive recognition of each path, not
   non-equivalence.

4. The "Migration timeline" is undefined (C-11): "one major-version
   bump" in a workspace with no version. The deprecation is
   open-ended.

5. The actual integration value the SPIRAL brief asks for —
   MDK-issued bolt-11 invoices, MDK-managed channels, MDK-side
   credential redemption — is documented in ADR 0014 §"Migration
   timeline" as the *next* step. The current step is wire-format
   only.

The hybrid is sound *as a step*. It is not sound as the destination
the README and ADR 0014 §"Decision" both claim. The honest reading is
that ADR 0014 deferred MDK adoption while preserving the option, and
the docs over-state how far down the path the code actually walks.

---

## 9. Deploy commit design review (`d64ebcf`)

**Verdict: admin hardening is complete; deploy contract is sound but
not ADR-bound.**

Strong points:

- `requireAdmin()` fails closed (503) on absent or short
  `ADMIN_SECRET`. No dev fallback.
- All three previously-affected routes converted to call the helper.
- `AGORA_REGISTRY_URL` is fail-loud at runtime in production for the
  web app, with a `NEXT_PHASE` escape so the build phase doesn't
  break.
- `--ha=false` invariant documented; the SQLite-corruption risk for
  multi-machine is called out.
- Pre-existing TS error (`reviews/dispute/route.ts` duplicate `ok`
  key) fixed in passing.
- Operational secrets (`ADMIN_SECRET`, `AGORA_REGISTRY_SECRET`)
  rotated via `fly secrets set`, no in-tree default values.

Soft points:

- The single-instance contract is operational (a runbook step), not
  enforced in code. A second `fly machine clone` will silently
  corrupt SQLite. ADR 0004 predicted SQLite-as-truth but didn't bind
  the deploy topology to it.
- Volume backups depend on Fly's daily snapshots + an ad-hoc SSH
  workflow; no application-level backup endpoint.
- `AGORA_REGISTRY_SECRET` (used for cross-service signed requests)
  is generated and set at deploy time but its rotation story isn't
  written down — services that hold the key in `.env.local` would
  desync silently.
- Web index has `revalidate = 0` only on `/activity`; the other six
  pages still cache without an invalidation hook on registry writes
  (an existing C-8 issue, not introduced here, but unaddressed).
- The dispute path remains un-admin-gated and un-buyer-gated; the
  hardening pass did not extend to it (C-4).

**Net.** The admin secret fix is clean. The deploy story is a
sensible single-instance posture. Neither is in an ADR; the deploy
contract should be (U-4).

---

## 10. Triple-aliasing and ADR 0014

ADR 0013 widened the attack surface: 3 MCP-tool name families,
3 env-var families, 3 HTTP-header families. ADR 0014 does not
narrow any of them; it adds a *fourth* shape (legacy macaroon
soft-transition) on top.

Surfaces in scope after ADR 0014:

| Surface | Active shapes | Trend |
|---|---|---|
| MCP tool names | 3 (`agora_*`, `andromeda_*`, `lumen_*`) | Unchanged |
| Env vars | 3 (`AGORA_*` → `ANDROMEDA_*` → `LUMEN_*`) | Unchanged |
| HTTP signed headers | 3 (`X-Agora-*`, `X-Andromeda-*`, `X-Lumen-*`) — but registry's gate accepts only canonical (C-6) | Unchanged; still mis-implemented |
| L402 macaroon format | 2 (MDK-shape, legacy `base64url(json).hmac`) | **Widened by ADR 0014** |
| Auth scheme | 2 (`L402`, `LSAT`) — was already there per bLIP-26 | Unchanged |

ADR 0014 makes the surface wider, not narrower. The deprecation
timelines for both ADR 0013 and ADR 0014 are open-ended (C-11), so
the surface is permanent until someone writes a "go-narrow" ADR.

---

## 11. New top 5 design concerns (ranked)

1. **CRITICAL — S-1 + S-2 still ship.** Honor is `±5N` for any
   colluder with one HTTP key generation step. Not addressed since the
   prior audit. Activity-feed makes the colluder's footprint visible
   to anyone who scrapes the feed, but does not prevent the attack.

2. **CRITICAL — ADR 0014 documents an MDK integration that does not
   exist in code (C-9).** The README, BUILD-SUMMARY, and ADR all
   describe a real-mode MDK path that the provider does not implement.
   This is the most impactful coherence gap in the repo right now,
   because it is the *centerpiece of the SPIRAL brief response*. The
   wire format is MDK-compatible; the system is not MDK-integrated.

3. **HIGH — Soft-transition L402 verifier widens attacker surface
   (C-12).** Two distinct authenticator constructions sharing one
   secret, no negative test for cross-construction confusion. The
   timeline to retire the legacy verifier is rhetorical (C-11).

4. **HIGH — Activity feed is a public counterparty graph (S-6, U-3,
   trace C).** Adds a privacy regression (full buyer pubkey + payment
   hash exposed), no rate limit, no ADR, no caching past 2 s. Easy to
   scrape. Hard to walk back once buyers depend on it.

5. **MEDIUM — Triple-aliasing + soft-transition macaroon together
   constitute a permanent compatibility burden (C-11, §10).** Two
   stacked open-ended deprecations on a non-versioned package. Every
   future signed-call or paid-call surface must respect *all* legacy
   shapes; deprecation is unconditioned on any concrete event.

(Concerns #3, #4, #5 from the prior audit list — escrow-as-counter,
unauth buyer attribution, blind-not-blind reviewer assignment — also
remain open. They are no longer in the top 5 only because two new
issues from ADR 0014 leapfrog them in *novelty*, not in severity.)

---

## 12. Summary

ADR 0014 (MDK migration) is, at the code level, a wire-format
rewrite of the in-house L402 layer using vendored MDK constants — not
an integration with MDK. Its README/ADR rhetoric over-states how much
MDK is on the runtime path. The hybrid story creates a permanent
soft-transition verifier and widens the auth surface; the deprecation
timeline that would retire either is undefined.

The activity feed PR (`5aacd66`) is functional and shippable but
public, uncached, and undescribed by any ADR. It exposes the
counterparty graph and per-tx payment hashes — a privacy regression
relative to the previous aggregate-only stats.

The deploy commit (`d64ebcf`) is the highlight: a clean, fail-secure
fix to the previous P1 default-admin-secret, a sensible single-instance
SQLite contract, and a fail-loud production posture for the web app.
The deploy contract should be promoted to an ADR.

The previous audit's top-5 design concerns are all unaddressed in
code. The post-MDK additions add new top-tier concerns above them.
