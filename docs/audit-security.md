# Agora Security Audit — post-MDK migration pass

> **Auditor:** independent security review (no prior context).
> **Date:** 2026-04-26
> **Scope:** the Agora monorepo as it stands after ADR 0014 (L402 →
> MDK wire format) and the deploy-hardening commit `d64ebcf` (admin
> secret fail-secure). All workspaces in scope: `provider/`, `buyer/`,
> `mcp/`, `registry/`, `dashboard/`, `web/`, `agents/dataset-seller/`,
> `agents/market-monitor/`, `packages/agora-core/`.
> **Mode:** code review + offline + live probes against running mock
> services on `localhost:3000` (provider), `:3030` (registry),
> `:3100` (market-monitor), `:3200` (dataset-seller). Probes were
> placed under `tmp/`, run, and deleted at the end of the audit.

This audit supersedes the previous `audit-security.md`. It reports the
status of each previously-recorded P0/P1, evaluates the MDK macaroon
migration, the soft-transition verifier, the deploy hardening, and
adds standard-pattern checks.

---

## 1. Threat model summary

The system mediates Lightning-paid agent-to-agent commerce. Trust is
asymmetric:

- **Sellers** are pseudonymous Ed25519 pubkeys; honor accumulates from
  buyer ratings + peer reviews. Honor is the only social signal a buyer
  has; inflating it is direct economic value.
- **Buyers** are pseudonymous; their primary attack value is identity
  spoofing — claim a transaction, claim a rating, claim a dispute —
  without paying.
- **Reviewers** are pseudonymous; their honor is at stake on every
  review. A successful slash from a third party destroys 50 honor and
  refunds the requester's escrow — a cheap economic weapon.
- **Subscriptions** carry a real sat balance; any unauthenticated
  mutator can refund-as-theft, top-up-as-grief, or cancel-as-DoS.
- **Platform / admin** endpoints expose decay-trigger, last-active
  back-dating, and revenue read.

Adversaries assumed: any unauthenticated party with HTTP access to
each service (registry, provider, dataset-seller, market-monitor)
plus, locally, the MCP control plane. We do **not** assume a
malicious co-tenant on the user's machine, but file-mode hygiene is
in scope where it directly stores private keys.

The Ed25519 signed-request canonical-string format and the L402
"Authorization: L402 <macaroon>:<preimage>" wire protocol are
**FROZEN**; they were not re-audited. The macaroon BYTE format
changed in ADR 0014 (MDK shape) and **was** re-audited.

---

## 2. Per-category findings

### 2.1 MDK macaroon migration (ADR 0014)

The new `packages/agora-core/src/l402.ts` mints
`base64(JSON({paymentHash, amountSats, expiresAt, resource, amount,
currency, sig}))` with `sig = HMAC-SHA256(deriveL402Key(secret),
…).hex` where `deriveL402Key(secret) = HMAC-SHA256(secret,
"mdk402-token-v1")`. This is byte-equivalent to MDK's documented
`mdk402-token-v1` token — confirmed by reading
`@moneydevkit/core/dist/mdk402/token.js` referenced in ADR 0014's
recon section.

**Defenses confirmed:**

- `ensureSecret(secret)` rejects empty / `<32 char` keys at mint AND
  verify time. Probe: `mintMacaroon({…}, "")` throws
  `L402SecretError`; `mintMacaroon({…}, "short")` likewise.
- `timingSafeEqual` used on `sig` comparison (line 177).
- KDF tag (`mdk402-token-v1`) is constant-time-derived; output is a
  32-byte SHA-256 HMAC.
- `verifyAuth` cross-checks `body.resource === expectedResource`
  AFTER format/HMAC validation, so resource confusion across
  endpoints (e.g. listing-verify ↔ order-receipt ↔
  dataset/:id/purchase) is rejected.
- Mock-mode shim is fully offline — no `mainnet.moneydevkit.com`
  egress; idempotency lives in the provider's existing SQLite
  invoices table.
- Cross-secret macaroon verification fails (probe: macaroon minted
  under SECRET-A returns null when verified under SECRET-B).
- The `MDK_ACCESS_TOKEN` env is referenced ONLY in real-mode (ADR
  0014 §"Mock"); no endpoint silently falls back to a "test mode"
  bypassing payment when the env is unset. (Real-mode payment relies
  on the wallet adapter's `lookupInvoice(payment_hash).paid` check
  in `provider/src/lib/l402.ts:127-135`. In mock mode this branch is
  skipped — this is *correct* because mock invoices are
  deterministic-preimage-only.)

**MDK-specific concerns:**

- **MDK-1 (P3, by design):** The new `verifyMacaroon` does **NOT**
  enforce `expiresAt`. ADR 0014 §"Macaroon wire format" states this
  is per-MDK design (paid credentials are permanent). The provider's
  SQLite `invoices.status` flip from `pending|paid → consumed`
  enforces single-use; but the dataset-seller and market-monitor
  rely on in-memory state. In particular, the dataset-seller's
  in-memory `Map` resets on restart — paid macaroons issued before
  restart are NOT re-replayable post-restart (the `invoices.has(h)`
  check returns false → 409). So the "permanent credential" choice
  is not directly exploitable, but it removes a defense-in-depth
  layer. Probe: `verifyAuth` accepts a macaroon minted with `exp =
  now − 999999s`. **Documented in ADR; flagged for awareness.**

- **MDK-2 (P3, by design):** Soft-transition verifier accepts BOTH
  `mdk` and `legacy` shapes. Both shapes have the same set of
  enforced fields (HMAC sig + `body.resource`). Neither enforces
  expiry. There is **no enforcement gap an attacker can exploit by
  downgrading** to the legacy shape: an attacker who could mint a
  legacy macaroon must already know `L402_SECRET`, in which case
  they can mint any shape they want. **Soft-transition does not
  introduce a downgrade exploit.** Probe: `mintMacaroonLegacy` then
  `verifyAuth` correctly returns `family: "legacy"`.

- **MDK-3 (informational):** Real-mode L402 (when MDK_ACCESS_TOKEN +
  MDK_MNEMONIC are set) currently still uses Agora's wallet adapter
  for invoice issuance — `provider/src/lib/l402.ts` calls
  `wallet().makeInvoice(...)` not MDK's `client.checkouts.create +
  mintInvoice`. ADR 0014 §"Migration timeline" describes this as the
  next refinement step. In real mode TODAY the provider will issue a
  real bolt-11 (via Alby/NWC) and verify it via the wallet adapter's
  `lookupInvoice(...).paid`; the macaroon is MDK-shape but the
  invoice is not MDK-issued. This is documented and not a security
  issue, but it means "MDK-real-mode" isn't really live.

### 2.2 Signature integrity (incoming)

- **Family-pinning at the verifier (`packages/agora-core/src/signed-request.ts`)** — once a header family is *chosen by presence* (all three of pubkey/timestamp/sig set), the signature is verified ONLY against that family. Cross-family confusion (e.g. `X-Agora-Pubkey` + `X-Andromeda-Sig`) is **not exploitable** because the OTHER family's headers are never consulted once a family is selected.
- **Family-downgrade to ANDROMEDA-only / LUMEN-only at the registry**: blocked. The registry's `verifySignedRequest` wrapper (`registry/src/lib/sig.ts:16-18`) explicitly requires the canonical AGORA `x-agora-*` headers be present and returns 401 "missing signature headers" otherwise. Confirmed in previous audit, behaviour unchanged.
- **Replay-window:** millisecond timestamp; ±5 min window. No nonce store; replay within the window is theoretically possible but very narrow and the canonical string is path-bound + body-bound.
- **Cross-pubkey replay:** signatures are tied to method + path + body-hash + timestamp; cannot be replayed against a different path. No issue.

### 2.3 Signature integrity (provider buyer-attribution)

- The provider's `/api/v1/listing-verify` and `/api/v1/order-receipt` and the dataset-seller's `/purchase` read the **naked** buyer-pubkey header `x-agora-pubkey` (with `x-andromeda-pubkey` and `x-lumen-pubkey` legacy fallbacks) **without verifying any signature against it**. The header is forwarded to `recordTxFireAndForget` and persisted as `transactions.buyer_pubkey` in the registry, where it gates rating eligibility. **This is the live P0-2 exploit (still present).**

### 2.4 L402 paywall

- Macaroon HMAC byte-format frozen and verified with `timingSafeEqual` (good).
- Macaroon body includes `resource`; cross-resource replay rejected at provider AND dataset-seller. **Confirmed defense.**
- **Provider** persists invoice rows and atomically transitions `pending → consumed`; second consumption returns 409. **Single-use macaroon enforced.** (`provider/src/lib/l402.ts:148-157`)
- **Dataset-seller** uses an in-memory `Map`; `invoices.has(h)` then `invoices.delete(h)` is sequential and atomic in single-threaded Node (no `await` between the check and the delete in `agents/dataset-seller/src/server.js:270-273`), so simple parallel replay is rejected. The previous audit's NEW-1 ("dataset-seller macaroon replay") **does not reproduce** under inspection; the gate is correct. Status: **fixed / non-exploitable**.
- **Market-monitor** does not paywall its subscription mutations at all, so L402 is not relevant there.
- **Soft-transition verifier**: passes both old and new shapes, with the same set of enforced checks. No downgrade exploit (see MDK-2).

### 2.5 Subscriptions

- Provider `/api/v1/subscribe`, `/topup`, `/cancel` and market-monitor mirror endpoints accept the request **with no signature, no L402, and no ownership check**. Anyone with the `subscription_id` (which is leakable through any list endpoint or recorded log) can cancel-for-refund or topup-as-grief. Live probe: subscribe with attacker-controlled pubkey ⇒ 200 ⇒ topup unauth ⇒ 200 ⇒ cancel unauth ⇒ 200 with `refunded_sats` returned. (P0-4 confirmed below.)

### 2.6 Wallet safety

- **Mock-mode honored:** `provider/src/lib/wallet.ts` selects mock vs. real on `MOCK_MODE`; mock invoices use deterministic preimages and no NWC traffic.
- **`/api/dev/pay` and `/api/dev/fire-alert` only enabled in mock mode:** correct guard at provider AND market-monitor + dataset-seller.
- **Per-call cap (`MAX_PRICE_SATS`):** enforced before reserving budget. Correct.
- **Per-session budget (`mcp/budget.js`):** has an unchanged TOCTOU race between `reserve()` and `confirm()` — `reserve()` reads `state.spent` but does **not** debit; `confirm()` adds. Parallel `callPaidEndpoint(...)` invocations all see the same `state.spent` snapshot and all pass. (P1-2 still exploitable; see §3.)
- **Kill-switch:** evaluated in `reserve()` synchronously; flipping it via the control plane prevents new spends. Good. Persists to JSON state file.
- **Control-plane bearer token comparison:** plain `===` string equality (`mcp/control-plane.js:103`); susceptible to timing leakage in theory. Practically low-impact on a localhost endpoint. Prior NEW-7 (P3) unchanged.

### 2.7 Peer-review escrow / honor

- **Submit-on-someone-else's-assignment:** `submitReview` checks `req.reviewer_pubkey !== args.reviewer_pubkey`. Defense confirmed.
- **Self-review:** `pickRandomReviewer(excludePubkey)` excludes requester; no self-rating possible.
- **Slashing-without-buyer-relationship (P0-3):** dispute route accepts any signed identity; no check that the disputer was the buyer in the underlying transaction or the requester of the review. A signed dispute from any pubkey will slash the reviewer for `-50` honor. Live probe: signed dispute against `rev_nonexistent` returns `404 "no such review"`, not 401 — confirming the signature was accepted independently of buyer relationship. (P0-3 still exploitable.)
- **Buyer-fraud slashing of the requester (claw escrow without slashing):** still not implemented; `slashReviewer` always returns escrow to the requester. The dispute route slashes on the same call, so a third party slashing benefits the (real) requester financially without paying for the slash themselves. Carried over.

### 2.8 Sybil / reputation

- `transactions/record` accepts `buyer_pubkey` from the body; only the seller signs. (P0-1.) Live probe:
  1. Register attacker-seller via signed `/sellers/register`.
  2. POST `/transactions/record` with `buyer_pubkey: <sock-pubkey>`, signed by the attacker-seller. Registry records `recorded:true, idempotent:false`.
  3. Sock pubkey then signs `POST /sellers/<attacker>/rate` with `stars:5`; rating accepted, attacker honor +2.
- **Sybil 5-star (or 1-star competitor) inflation confirmed.**

### 2.9 Privacy / file modes

- `~/.agora/control-token` and `~/.agora/control-port` are written via `fs.writeFileSync(path, value, { mode: 0o600 })`. Windows NTFS does not honor the Unix mode argument; observed `stat` shows world-readable to processes under the user's account. **Test-environment limitation.**
- `mcp/.env` and `provider/.env.local` are auto-written **without any mode option** (`fs.writeFileSync(fp, line, "utf8")`, `fs.appendFileSync(...)`). Both files contain Ed25519 *private keys* (`AGORA_PROVIDER_PRIVKEY`, `AGORA_BUYER_PRIVKEY`). Carried over: NEW-2 (P2).
- The state-dir migration (`packages/agora-core/src/state-dir.ts:71-82`) uses `fs.copyFileSync(s, d)` without explicitly setting destination mode — preserves source mode bits.
- `transactions.log` (contains pubkeys + payment_hashes + amounts) is mode 644 on POSIX semantics.

### 2.10 Admin endpoints — **deploy hardening verified**

The new `registry/src/lib/admin.ts` `requireAdmin(req)`:
- **No header** ⇒ 401 (live probe). ✓
- **Wrong secret** ⇒ 401 (live probe). ✓
- **`ADMIN_SECRET` unset in env** ⇒ 503 "admin endpoints disabled (ADMIN_SECRET not set or too short)". ✓ (verified by reading `admin.ts:11-15` and the routes' `requireAdmin(req)` short-circuit return).
- **Hard-coded `dev-admin-secret` fallback REMOVED** from `/v1/admin/decay`, `/v1/admin/fast-forward`, `/v1/platform/revenue`, and `/v1/reviews/:id/dispute` (the latter still uses a separate `SIGNING_SECRET` for the **slashing-event audit-log signature**, which is a different code path; see below). ✓
- The literal string `"dev-admin-secret"` no longer appears in `registry/src/`. It is referenced only in test scripts (`scripts/test-phase5.js`, `scripts/test-phase6.js`, `scripts/probe-attacks.js`) which set the env var before invoking the registry; this is consistent with the new fail-secure model.

**Live probe results** (registry running with `ADMIN_SECRET=dev-admin-secret` set in shell env):

| Probe                                                | Result             |
|------------------------------------------------------|--------------------|
| `POST /v1/admin/decay` no header                     | **401 unauthorized** ✓ |
| `POST /v1/admin/decay` `x-admin-secret: wrong`       | **401 unauthorized** ✓ |
| `POST /v1/admin/decay` `x-admin-secret: dev-admin-secret` | 200 (because env-set; this is correct fail-open-only-with-explicit-env behavior) |
| `GET /v1/platform/revenue` no header                 | 401 ✓ |

To validate the unset-env path, the registry would need to be restarted without `ADMIN_SECRET` in the environment; the source review of `requireAdmin` confirms 503 is returned.

**P1 NEW-3 (default admin secret) is FIXED.** P1-4 promoted from "carried" → "fixed".

### 2.11 Slashing-event signing secret (separate from admin secret)

- `registry/src/app/api/v1/reviews/[id]/dispute/route.ts:19-23` still has a **fall-through default** for `SIGNING_SECRET`:
  ```ts
  const SIGNING_SECRET =
    process.env.AGORA_REGISTRY_SECRET ??
    process.env.ANDROMEDA_REGISTRY_SECRET ??
    process.env.L402_SECRET ??
    "registry-default-secret-please-set-something-stronger";
  ```
  This secret is used only to HMAC the **audit-log signature** stored in `slashing_events.signature`. It is not used for authn. Impact: an attacker reading the source can forge `slashing_events.signature` rows post-incident if they have direct DB access. Carried over: NEW-4 (P2).

### 2.12 Rate limiting

- `provider/src/lib/ratelimit.ts:16-21` reads `x-forwarded-for` first, then `x-real-ip`, with no allowlist of trusted proxies. Live probe: 50 requests with rotating `x-forwarded-for: 10.0.0.<i>` → **50/50 OK, 0 blocked** (P1-3 still exploitable).

### 2.13 MCP env-var fallback chain duplication (NEW-5 carried)

The inline `AGORA_X ?? ANDROMEDA_X ?? LUMEN_X` pattern is still duplicated in many files (`mcp/identity.js`, `mcp/control-plane.js`, `mcp/budget.js`, `provider/src/lib/registry-client.ts`, `agents/dataset-seller/src/server.js`, etc.). None validate the resolved value. If `AGORA_BUYER_PRIVKEY` is unset and `LUMEN_BUYER_PRIVKEY` is set to attacker-controlled bytes, the MCP signs with whatever the attacker chose. Documented behavior; widens env-injection surface.

### 2.14 Provider admin auth ignores rebrand chain (NEW-8 carried)

`provider/src/lib/admin-auth.ts` still reads only `LUMEN_ADMIN_USER` / `LUMEN_ADMIN_PASS`, not the AGORA / ANDROMEDA chain — so the provider's admin endpoints are silently disabled on a fresh AGORA install (the credentials never resolve unless the operator uses LUMEN-prefixed env vars). Same string also uses `!==` rather than `timingSafeEqual`. Carried (P3).

### 2.15 Dataset-seller signed-URL replay (P1-1 carried)

Signed download URL has 24h TTL, no buyer binding, no single-use. The macaroon paywall happens once; the resulting URL is bearer-quality for 24h. Anyone given/snooping the URL can re-download. Carried.

### 2.16 Dataset-seller fallback HMAC key (NEW-MDK-1 here)

`agents/dataset-seller/src/server.js:147,154` use `L402_SECRET || "fallback"` for the **signed-URL** HMAC. If `L402_SECRET` is unset, the literal string `"fallback"` is used. (MintMacaroon for the L402 paywall throws on empty secret via `ensureSecret`, so the macaroon path is safe; only the signed-URL HMAC path is affected.) An attacker who knows the env is unset can mint their own signed URLs.

Severity: **P2**, conditional on `L402_SECRET` being unset, which prints a console warning at boot but does not refuse to start. Same pattern in `agents/market-monitor/src/server.js:172` for alert signatures (`createHmac("sha256", L402_SECRET || "fallback")`).

---

## 3. Status of previous audit's findings

| ID    | Description                                                        | Status                                                                            |
|-------|--------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| **P0-1** | Sybil honor inflation via forged `/v1/transactions/record`     | **Still exploitable** (live probe)                                                |
| **P0-2** | Honor inflation via spoofed `x-agora-pubkey` header            | **Still exploitable** (live probe; legacy `x-lumen-pubkey` accepted too)         |
| **P0-3** | Anyone can slash any reviewer via `/v1/reviews/:id/dispute`    | **Still exploitable** (signature accepted independently of buyer-relationship)    |
| **P0-4** | Subscriptions unauthenticated (subscribe / topup / cancel)     | **Still exploitable** (live probe on market-monitor: 200/200/200 with refund)    |
| **P1-1** | Dataset-seller signed-URL replay within macaroon TTL           | **Still exploitable** (URL TTL 24h, no buyer-binding)                            |
| **P1-2** | Budget cap parallel-call TOCTOU between `reserve()` and `confirm()` | **Still exploitable** (no atomic-debit in `reserve()`; confirmed)            |
| **P1-3** | Rate-limit bypass via spoofed `x-forwarded-for`                | **Still exploitable** (50/50 success live)                                       |
| **P1-4** | Default `dev-admin-secret` exposes admin endpoints             | **FIXED** (`registry/src/lib/admin.ts` requires explicit env; live probe confirms 401 without correct header) |
| **NEW-1** (P1) | Dataset-seller macaroon replay (claimed prior)           | **Re-evaluated: not exploitable.** The `Map.has` + `Map.delete` is sequential in single-threaded Node with no `await` between them; the gate is correct. |
| **NEW-2** (P2) | Privkey files at world-readable mode                     | **Still present** (`mcp/.env`, `provider/.env.local` written without `mode`)     |
| **NEW-3** (P1) | Default admin secret hardcoded                           | **FIXED** (same as P1-4)                                                          |
| **NEW-4** (P2) | Default slashing-event signing secret                    | **Still present** (`dispute/route.ts:19-23` literal-string fallback)             |
| **NEW-5** (P2) | Inline env-var fallback duplicated, unvalidated          | **Still present**                                                                  |
| **NEW-6** (P3) | Doc/behaviour mismatch on header families (registry pin to AGORA) | **Still present**                                                          |
| **NEW-7** (P3) | Control-plane bearer-token timing leak                   | **Still present** (`===` compare; localhost-only)                                |
| **NEW-8** (P3) | Provider admin auth ignores rebrand chain                | **Still present**                                                                  |

### 3.1 Live probe results

| Probe                  | Outcome                                                                                          |
|------------------------|--------------------------------------------------------------------------------------------------|
| `tmp/probe-p0s.mjs` §P0-1 | Registered fake seller; forged tx with arbitrary `buyer_pubkey` accepted (`recorded:true, idempotent:false`); buyer-pubkey then successfully rated the seller 5-star (`new_honor:2`). |
| `tmp/probe-p0s.mjs` §P0-2 | 240-sat L402 round-trip with `x-lumen-pubkey: <victim>` returned 200; provider fired tx-record with the victim as buyer. |
| `tmp/probe-p0s.mjs` §P0-3 | Random-pubkey signed dispute against `rev_nonexistent` returned 404 "no such review" (not 401), confirming signature accepted independently of buyer-relationship. |
| `tmp/probe-p0s.mjs` §P0-4 | Anonymous subscribe/topup/cancel on market-monitor: 200/200/200; `refunded_sats:13344` returned to caller. |
| `tmp/probe-p0s.mjs` §P1-3 | 50 parallel `/api/health` calls with rotating `x-forwarded-for` 10.0.0.0–10.0.0.49 → 50 OK, 0 rate-limited. |
| `tmp/probe-mdk.mjs` (offline) | KDF derived key 32 bytes; new-shape verify true; legacy-shape verify true via soft-transition; cross-secret rejected; empty/short-secret mint throws `L402SecretError`. |
| `curl /v1/admin/decay` no header  | 401. ✓ |
| `curl /v1/admin/decay` wrong secret | 401. ✓ |
| `curl /v1/platform/revenue` no header | 401. ✓ |

(All probes deleted from `tmp/` post-audit; the reproducers are easy to derive from this report.)

---

## 4. New exploits that worked / new findings

| ID         | Severity | MDK? | Finding |
|------------|----------|------|---------|
| **MDK-1**  | P3       | yes  | Soft-transition + new-shape verifier ignore `expiresAt` entirely (per MDK design). Removes a defense-in-depth layer; not directly exploitable because the seller's invoice store enforces single-use. Documented in ADR 0014. |
| **MDK-2**  | P3 (informational) | yes | Soft-transition does **not** introduce a downgrade attack — both shapes enforce the same fields (HMAC + resource), neither enforces expiry. An attacker presenting a legacy macaroon must already know `L402_SECRET` to mint a valid one. |
| **MDK-3**  | informational | yes | Real-mode L402 today still uses Agora's wallet adapter for invoice issuance, not MDK's `client.checkouts.create`. The macaroon is MDK-shape but the invoice rail is NWC/Alby. Documented in ADR 0014 §"Migration timeline" as the next refinement step. |
| **NEW-MDK-A** | P2     | yes  | `agents/dataset-seller/src/server.js:147,154` and `agents/market-monitor/src/server.js:172` use `L402_SECRET \|\| "fallback"` for the **signed-download-URL HMAC** and **alert-signature HMAC** respectively. If `L402_SECRET` is unset, the literal string `"fallback"` is used — anyone reading the source can mint a valid signed URL or forge an alert signature. Mint-side macaroon code (`mintMacaroon`) is safe (it throws on empty secret). |

(no new P0s discovered.)

---

## 5. Defenses confirmed working

- **MDK macaroon mint is robust:** secret length enforced at mint AND verify (`ensureSecret` → throws on `<32 chars`); KDF tag `mdk402-token-v1` matches MDK's documented domain separator; `timingSafeEqual` on `sig`; resource bound as `<METHOD>:<path>`; cross-secret macaroons are rejected.
- **Mock-mode is fully offline:** verified by code review — `mintMacaroon` has no `fetch` / `fs` calls outside the L402 wallet adapter, which is itself mock when `MOCK_MODE=true`.
- **Soft-transition verifier accepts both shapes** with the same enforced check set; no downgrade attack.
- **Family-pinning at the verifier**: cross-family confusion not exploitable; registry hard-pins to AGORA family at the wrapper level.
- **Macaroon resource-binding:** macaroons minted for `/v1/listing-verify` cannot be replayed at `/v1/order-receipt`, and provider macaroons cannot be replayed at the dataset-seller's `/purchase`.
- **Provider single-use macaroon enforcement:** atomic SQLite `pending → consumed`.
- **Dataset-seller single-use macaroon enforcement:** sequential `Map.has` + `Map.delete` — atomic in single-threaded Node, so simple parallel replay is rejected. (Re-evaluated; previous audit's NEW-1 was incorrect.)
- **Mock-mode dev endpoints disabled in real mode:** `/api/dev/pay`, `/api/dev/fire-alert`, `/api/dev/tick` all return 404 when `MOCK_MODE=false`.
- **Migrations are non-destructive:** `~/.andromeda/` preserved when `~/.agora/` is created.
- **CORS lockdown on control plane:** single allowed origin `http://localhost:5173`; preflight from arbitrary origins returns 403.
- **`recordTransaction` idempotency:** SQLite `payment_hash UNIQUE` prevents duplicate-tx amplification of the same forged record.
- **Reviewer-pickedness check** in `submitReview`: a non-assigned reviewer cannot submit on someone else's review_request.
- **Buyer 30-day rating cooldown:** mostly ineffective because P0-1 forges the underlying tx, but it's a working gate against pure-anonymous rating.
- **Timing-safe macaroon HMAC compare** in `packages/agora-core/src/l402.ts:177`.
- **Deploy hardening on admin endpoints:** `/v1/admin/decay`, `/v1/admin/fast-forward`, `/v1/platform/revenue` reject any request without a matching `ADMIN_SECRET` env value; with `ADMIN_SECRET` unset they return 503. The literal `"dev-admin-secret"` fallback string was removed from the registry source. Confirmed live by 401 on no-header / wrong-secret probes. **P1-4 / NEW-3 fixed.**

---

## 6. Dependency scan results

`npm audit --json` per workspace, Node 20.19.0, npm v10:

| Workspace             | Vulns | Highest  | Detail                                                                |
|-----------------------|-------|----------|-----------------------------------------------------------------------|
| Root (`lumen`)        | 4     | moderate | esbuild ≤0.24.2 (GHSA-67mh-4wv8-2f99); postcss <8.5.10 in next (GHSA-qx2v-qp2m-jg93); vite ≤6.4.1 path-traversal (GHSA-4w7w-66w2-5vf9); next (transitive postcss) |
| `provider/`           | 2     | moderate | postcss <8.5.10 via next                                              |
| `registry/`           | 2     | moderate | postcss <8.5.10 via next                                              |
| `web/`                | (covered by root) | moderate | postcss <8.5.10 via next                                       |
| `mcp/`                | 0     | —        | clean                                                                  |
| `dashboard/`          | 2     | moderate | esbuild + vite                                                        |
| `agents/dataset-seller/` | 0  | —        | no deps beyond Node stdlib + better-sqlite3                           |
| `agents/market-monitor/` | 0  | —        | same                                                                   |
| `packages/agora-core/`   | 0  | —        | clean                                                                  |

No HIGH or CRITICAL findings. Same set as previous audit; "noble fixes" did not surface here as `@noble/*` is clean. esbuild/vite advisories are dev-server-only. The next/postcss advisory (CSS XSS via unescaped `</style>`) only matters if a registry/provider/web page renders attacker-controlled HTML inside a `<style>`; no such surface exists.

---

## 7. Summary table

| Severity | Count | IDs |
|----------|------:|-----|
| **P0**   | 4     | P0-1, P0-2, P0-3, P0-4 — **all carried, all still exploitable** |
| **P1**   | 3     | P1-1, P1-2, P1-3 — **all carried, all still exploitable** (P1-4 was FIXED) |
| **P2**   | 4     | NEW-2, NEW-4, NEW-5, NEW-MDK-A |
| **P3**   | 5     | MDK-1, MDK-2, NEW-6, NEW-7, NEW-8 |

**P0/P1 totals (carried + new):** 4 P0 + 3 P1 = 7 high-severity issues open.

### MDK security verdict (one sentence)

The MDK migration is implemented correctly — wire format byte-equivalent, KDF tag matches, secret-length enforcement on mint and verify, `timingSafeEqual` HMAC compare, resource binds METHOD+path, mock shim fully offline, no env-set bypass — and the soft-transition verifier introduces no downgrade exploit; the only MDK-related findings are by-design (no `expiresAt` enforcement, P3) and unrelated-but-adjacent (HMAC fallback to literal `"fallback"` for **non**-paywall HMACs in two seller services when `L402_SECRET` is unset, P2).

### Deploy hardening verdict

The `d64ebcf` deploy-hardening commit successfully removed the `dev-admin-secret` fallback for all four admin/platform routes. Live probes confirm 401 on no-header / wrong-header; source review confirms 503 when `ADMIN_SECRET` is unset. **P1-4 / NEW-3 fixed.**

### Carried-over notes

- The four P0s and three remaining P1s were not in scope of either the MDK migration or the deploy-hardening commit and are unchanged.
- The previous audit's NEW-1 (dataset-seller macaroon replay) was **re-evaluated and found not exploitable** — the `Map.has` / `Map.delete` is atomic in single-threaded Node.

End of report. No fixes proposed (per audit brief).
