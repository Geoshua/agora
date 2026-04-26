# Agora Security Audit — post-rebrand pass

> **Auditor:** independent security review (no prior context).
> **Date:** 2026-04-26
> **Scope:** the Agora monorepo as it stands post-ADR-0013 rebrand
> (Andromeda → Agora). Includes all workspaces: `provider/`, `buyer/`,
> `mcp/`, `registry/`, `dashboard/`, `web/`, `agents/dataset-seller/`,
> `agents/market-monitor/`, `packages/agora-core/`.
> **Mode:** code review + live probes against running mock-mode
> services on `localhost:3000` (provider) and `localhost:3030`
> (registry). Probes archived under `tmp/probe-*.mjs` (deleted at end
> of audit).

This audit supersedes the previous `audit-security.md`. It reports the
status of every previously-reported P0/P1, plus rebrand-introduced
exploits and standard-pattern checks.

---

## 1. Threat model summary

The system mediates Lightning-paid agent-to-agent commerce. Trust is
asymmetric:

- **Sellers** are pseudonymous Ed25519 pubkeys; honor accumulates from
  buyer ratings + peer reviews. Honor is the only social signal a buyer
  has; inflating it grants a seller economic advantage at no cost.
- **Buyers** are pseudonymous; their primary attack value is being able
  to spoof identity (claim a transaction, claim a rating, claim a
  dispute) without paying. A successful spoof inflates *someone else's*
  honor or *their own* rating power.
- **Reviewers** are pseudonymous; their honor is at stake on every
  review. A successful slash from a third party destroys 50 honor and
  refunds the requester's escrow — a cheap economic weapon.
- **Subscriptions** carry a real sat balance; mutating one without auth
  is direct theft (refund) or denial-of-service (cancel).

Adversaries assumed: any unauthenticated party with HTTP access to
the registry, the provider, the dataset-seller, the market-monitor,
and (locally) the MCP control plane. We do **not** assume a malicious
process colocated with the user's Node runtime (private-key
exfiltration via filesystem is in scope only because the rebrand was
expected to tighten file modes; it didn't).

The macaroon HMAC byte-format and the Ed25519 signed-request
canonical-string format are FROZEN per ADR 0013 §Decision; they were
not re-audited.

The signed-request verifier supports three header families
(`X-Agora-*`, `X-Andromeda-*`, `X-Lumen-*`), with `family` returned in
`VerifyResult`. The verifier picks the first family for which all
three headers are *present*, then validates only that family's
signature. This is rebrand-1 + rebrand-2 backward compatibility.

---

## 2. Per-category findings

### 2.1 Signature integrity (incoming)

- **Family-pinning at the verifier (`packages/agora-core/src/signed-request.ts`)** — once a family is chosen by presence-of-three-headers, the signature is verified ONLY against that family's three values. Cross-family confusion (e.g. `X-Agora-Pubkey: A` + `X-Andromeda-Sig: B`) is **not exploitable** because:
  1. If the higher-priority family is incomplete, the verifier falls through to the next.
  2. Once a family is chosen, the OTHER family's headers are never consulted by `verifyRequest`.
- **Family-downgrade attempts** — verified probes (`tmp/probe-rebrand.mjs`) confirmed: a request that supplies AGORA-Pubkey only (no AGORA-Sig/Timestamp) plus a complete ANDROMEDA family **does** fall through to the ANDROMEDA family at the core verifier. **However**, the registry's wrapper (`registry/src/lib/sig.ts`) explicitly checks that the canonical AGORA headers are present before invoking `verifyRequest` and returns 401 "missing signature headers" otherwise. **Net result on the registry: ANDROMEDA-only and LUMEN-only signed requests are REJECTED.** This contradicts the README + BUILD-SUMMARY claim that all three families are accepted on incoming requests; treated as a **finding** below (P3, doc/behavior mismatch — though the actual behavior is *more* secure than documented).
- **Replay-window:** the canonical string includes a millisecond timestamp; window enforced at ±5 min (`SIGNATURE_VALIDITY_MS`). No nonce store, but the timestamp window is small enough that this is a low-impact replay risk.
- **Cross-pubkey replay:** the canonical string includes path + body-hash; signatures are not bound to the receiver, so a request signed for `/api/v1/sellers/register` cannot be replayed against `/api/v1/transactions/record`. No issue.

### 2.2 Signature integrity (provider buyer-attribution)

- The provider's `/api/v1/listing-verify` and `/api/v1/order-receipt` routes — and the dataset-seller's `/purchase` — read the **naked** buyer-pubkey header `x-agora-pubkey` (or its legacy aliases) **without verifying any signature against it**. The header is then forwarded to `recordTxFireAndForget` and persisted as `transactions.buyer_pubkey` in the registry, where it gates rating eligibility. **This is the live P0-2 exploit (still present, family-expanded to include `x-lumen-pubkey`).**

### 2.3 L402 paywall

- Macaroon HMAC byte-format frozen and verified with `timingSafeEqual` (good).
- Macaroon body includes `resource`; cross-resource replay rejected at provider AND dataset-seller. **Confirmed defense.**
- **Provider** persists invoice rows and atomically transitions `pending → consumed`; second consumption returns 409. **Single-use macaroon enforced.** (`provider/src/lib/l402.ts:148-157`)
- **Dataset-seller** does **NOT** enforce single-use macaroon: line 264 does `invoices.delete(macBody.payment_hash)` but never gates on its presence. Two parallel calls with the same `(macaroon, preimage)` both pass — **macaroon replay possible**, especially in concurrent flows. New finding: **NEW-1, P1**.
- **Market-monitor** does not paywall its subscription mutations at all, so L402 is irrelevant there (see 2.4).
- **Expired macaroon:** the body's `exp` is checked against `Date.now()/1000`; expired bodies return null. Good.

### 2.4 Subscriptions

- Both `provider/api/v1/subscribe` + `subscriptions/:id/topup`, `cancel`, and `agents/market-monitor` mirror endpoints accept the request **with no signature, no L402, and no ownership check**. Anyone with the `subscription_id` can cancel-for-refund or topup-as-griefing. (P0-4 confirmed below.)

### 2.5 Wallet safety

- **Mock-mode honored:** `provider/src/lib/wallet.ts` selects mock vs. real on `MOCK_MODE`; mock invoices use deterministic preimages and no NWC traffic. Confirmed.
- **`/api/dev/pay` only enabled in mock mode:** correct guard. Confirmed.
- **Per-call cap (MAX_PRICE_SATS):** enforced before reserving budget. Correct.
- **Per-session budget (`mcp/budget.js`):** has a TOCTOU race between `reserve()` and `confirm()` — `reserve()` reads `state.spent` but does NOT debit; `confirm()` adds. Parallel calls can each pass `reserve()` and over-spend. (P1-2 confirmed below.)
- **Kill-switch:** evaluated inside `reserve()` synchronously; flipping it via the control plane prevents new spends. Good. The flag persists to the same JSON state file.
- **Control-plane bearer token comparison:** plain `===` string equality (`mcp/control-plane.js:103`); susceptible to timing leakage in theory. Practically low-impact on a localhost endpoint. **NEW-7, P3.**

### 2.6 Peer-review escrow / honor

- **Claim unassigned review:** `submitReview` checks `req.reviewer_pubkey !== args.reviewer_pubkey`. A reviewer cannot submit a review they were not assigned. Defense confirmed.
- **Submit for self-paid review:** the review-request route picks a random reviewer ≠ requester pubkey. The requester cannot self-review. Defense confirmed.
- **Slashing without buyer relationship (P0-3):** dispute route accepts any signed identity and slashes the reviewer for -50 honor. Confirmed exploitable below.
- **Buyer-fraud slashing (claw escrow without slashing):** not implemented; `slashReviewer` always returns the escrow to the requester. The dispute route slashes on the same call, so an attacker can both slash a reviewer AND see the escrow returned to the (real) requester — a third party doing this is a free attack on the reviewer; the requester benefits financially without paying for the slashing themselves.

### 2.7 Sybil / reputation

- `transactions/record` accepts `buyer_pubkey` from the body; only the seller signs. (P0-1.)
- `rateSeller` looks up `transactions WHERE buyer_pubkey=? AND seller_pubkey=?` to gate ratings. Combined with P0-1, an attacker registers as a seller, posts forged transactions citing sock-pubkeys, then those sock-pubkeys rate any seller that the attacker (as that seller) has "transacted" with. **Sybil 5-star (or 1-star competitor) inflation confirmed.**

### 2.8 Privacy / file modes

- `~/.agora/control-token` and `~/.agora/control-port` are written via `fs.writeFileSync(path, value, { mode: 0o600 })` but Windows NTFS does not honor the Unix mode argument; observed `stat` shows `644`. The token is therefore world-readable to any process running under the user's account. (Test-environment limitation; the auditor's working-principle note in the brief flags this as "approximate on Windows".)
- `mcp/.env` and `provider/.env.local` are written **without any mode option** (`fs.writeFileSync(fp, line, "utf8")`, `fs.appendFileSync(...)`); observed `644` on POSIX semantics. Both files contain Ed25519 *private keys*. **NEW-2, P2.**
- The state-dir migration (`packages/agora-core/src/state-dir.ts:71-82`) calls `fs.copyFileSync(s, d)` without explicitly setting the destination mode. Node's `copyFileSync` preserves the source mode bits; if `~/.andromeda/control-token` was 644, the migrated `~/.agora/control-token` is also 644. The MIGRATED-FROM-ANDROMEDA marker is written with `mode: 0o600` (line 60), but everything else inherits whatever was there.
- `transactions.log` (which contains buyer/seller pubkeys + payment_hashes + amounts) is mode 644.

### 2.9 Admin endpoints

- `/api/v1/admin/decay`, `/api/v1/admin/fast-forward`, `/api/v1/platform/revenue` all default to `ADMIN_SECRET ?? "dev-admin-secret"`. The default is hard-coded plaintext in three files. Any party with HTTP access can force decay (cratering inactive sellers' honor), backdate sellers, or read total platform revenue. **NEW-3, P1.**
- The slashing-event signing-secret (`registry/src/app/api/v1/reviews/[id]/dispute/route.ts:23`) defaults to `"registry-default-secret-please-set-something-stronger"`. Any party reading the source can forge slashing-event audit signatures. **NEW-4, P2** (low impact — the audit log is local to the registry DB and the signature is decorative; but the spec presents it as a tamper-evidence mechanism).

### 2.10 Rate limiting

- IP extraction in `provider/src/lib/ratelimit.ts:16-21` reads `x-forwarded-for` first, then `x-real-ip`, no allowlist of trusted proxies. Bypass confirmed below (P1-3).

### 2.11 Migration shim

- `state-dir.ts` migration is non-destructive (legacy dir preserved). It does **not** copy with stricter modes; if the source was insecure, the destination inherits.
- `mcp/budget.js`, `mcp/control-plane.js`, `provider/src/lib/registry-client.ts`, and several other files implement the env-var resolution chain `AGORA_X ?? ANDROMEDA_X ?? LUMEN_X` **inline** (rather than via `@agora/core`'s `readEnv`). This duplicates the chain in many places. None of them validate the value; whatever string the env supplies is trusted. If `AGORA_BUYER_PRIVKEY` is unset and `LUMEN_BUYER_PRIVKEY` is set to attacker-controlled bytes, the MCP server uses it. **NEW-5, P2** (informational — this is the documented behavior, but it widens the env-injection surface).

### 2.12 Documented vs. actual behavior

- README + BUILD-SUMMARY say "Verifier accepts EITHER family on incoming requests" / "Every Ed25519-signed endpoint accepts `X-Agora-*` (canonical), `X-Andromeda-*`, AND `X-Lumen-*` header families on incoming requests." **Actual:** the registry's `verifySignedRequest` wrapper requires the canonical AGORA headers be present, returning 401 otherwise. ANDROMEDA-only and LUMEN-only signed requests are rejected by the registry. This is *more secure* than the docs claim, but breaks the migration story for legacy buyers. Confirmed by probe `tmp/probe-rebrand.mjs`. **NEW-6, P3** (documentation/behavior mismatch).

---

## 3. Status of previous audit's findings

| ID    | Description                                                 | Status                |
|-------|-------------------------------------------------------------|-----------------------|
| **P0-1** | Sybil honor inflation via forged `/v1/transactions/record` | **Still exploitable** |
| **P0-2** | Honor inflation via spoofed `x-andromeda-pubkey` header on listing-verify / order-receipt | **Worse** — three header families now spoofable (x-agora-pubkey, x-andromeda-pubkey, x-lumen-pubkey); also affects dataset-seller |
| **P0-3** | Anyone can slash any reviewer via `/v1/reviews/:id/dispute` | **Still exploitable** |
| **P0-4** | Subscriptions unauthenticated (subscribe / topup / cancel)  | **Still exploitable** (provider AND market-monitor) |
| **P1-1** | Dataset-seller signed-URL replay within macaroon TTL        | **Still exploitable** — signed URL has 24h TTL, no buyer binding, no single-use; additionally **macaroon itself is replayable** at the dataset-seller (NEW-1) |
| **P1-2** | Budget cap parallel-call TOCTOU between `reserve()` and `confirm()` | **Still exploitable** |
| **P1-3** | Rate-limit bypass via spoofed `x-forwarded-for`             | **Still exploitable** |

### 3.1 Live probe results

| Probe                  | Outcome                                                                                  |
|------------------------|------------------------------------------------------------------------------------------|
| `tmp/probe-p0-1.mjs`   | Registered fake seller; forged tx with arbitrary buyer_pubkey accepted (`recorded:true, idempotent:false`); buyer-pubkey then successfully rated the seller 5-star. |
| `tmp/probe-p0-2.mjs`   | Single 240-sat L402 call with `x-lumen-pubkey: <victim>` header → registry tx_count for vision-oracle-3 incremented with the victim's pubkey as buyer. |
| `tmp/probe-p0-3.mjs`   | Random 3rd-party `attacker` pubkey disputed a legit review → reviewer's seller-honor row dropped to -50; escrow returned. |
| `tmp/probe-p0-4.mjs`   | Subscribed (no auth, attacker-controlled subscriber_pubkey), topped-up to 6,000 sats, cancelled and was returned `refunded_sats:6000`. |
| `tmp/probe-budget.mjs` | 5 parallel `reserve(300)` against `MAX_BUDGET_SATS=1000` all returned `null`; after 5 confirms, `spent_sats=1500` (50% over cap). |
| `tmp/probe-rl.mjs`     | Same-IP burst: 35/60 succeeded, 25 blocked; rotated `x-forwarded-for` (10.0.0.0–10.0.0.59): 59/60 succeeded. |
| `tmp/probe-rebrand.mjs` | ANDROMEDA-only or LUMEN-only signed `/sellers/register` rejected (401 "missing signature headers") — confirms registry hard-pins to AGORA family at the wrapper. |
| `curl -X POST … x-admin-secret: dev-admin-secret` | `/v1/admin/fast-forward` and `/v1/platform/revenue` succeed with the hard-coded default secret. |

(All probes have been deleted from `tmp/` post-audit; reproducers are easy to re-derive from this report.)

---

## 4. New exploits that worked

| ID | Severity | Finding |
|----|----------|---------|
| **NEW-1** | **P1** | **Dataset-seller macaroon replay.** `agents/dataset-seller/src/server.js:255-291` accepts the same `(macaroon, preimage)` from any caller. The line `invoices.delete(macBody.payment_hash)` does NOT gate on prior presence; two concurrent calls each pass macaroon+preimage verification and each receive a fresh signed download URL. Combined with **P1-1** (signed URL not bound to buyer + 24h TTL), one paid macaroon can be replayed indefinitely until it expires (`exp` from the macaroon body, currently 300s) — and within that window, every replay produces a fresh 24h download URL. |
| **NEW-2** | **P2** | **Privkey files at world-readable mode.** `provider/.env.local` and `mcp/.env` are written via `fs.writeFileSync` / `fs.appendFileSync` with NO `mode` option, so they get the default umask. Observed `644` on POSIX semantics; same on Windows where NTFS doesn't honor Unix modes anyway. Both files contain Ed25519 private keys (`ANDROMEDA_PROVIDER_PRIVKEY`, `ANDROMEDA_BUYER_PRIVKEY`). |
| **NEW-3** | **P1** | **Default admin secret (`"dev-admin-secret"`).** Three registry routes (`/v1/admin/decay`, `/v1/admin/fast-forward`, `/v1/platform/revenue`) compare `x-admin-secret` against `process.env.ADMIN_SECRET ?? "dev-admin-secret"`. The default is hard-coded; any party with HTTP access to the registry can force-decay all sellers, backdate sellers, or read platform revenue. Verified live with curl. |
| **NEW-4** | **P2** | **Default slashing-event signing secret** (`"registry-default-secret-please-set-something-stronger"`). The dispute route's `SIGNING_SECRET` falls back to a literal-string value if `AGORA_REGISTRY_SECRET` / `ANDROMEDA_REGISTRY_SECRET` / `L402_SECRET` are all unset. Any reader of the source can forge `slashing_events.signature` rows. |
| **NEW-5** | **P2** | **Inline env-var fallback chain duplicated everywhere, with no validation.** `mcp/identity.js`, `mcp/control-plane.js`, `mcp/budget.js`, `provider/src/lib/identity.ts`, `provider/src/lib/registry-client.ts`, `agents/dataset-seller/src/server.js`, etc. each independently re-implement `AGORA_X ?? ANDROMEDA_X ?? LUMEN_X`. None validate the resulting value (length, format, hex-ness). If `AGORA_BUYER_PRIVKEY` is unset and `LUMEN_BUYER_PRIVKEY` is set to attacker-controlled bytes (e.g. via a shared shell config injected through `direnv`), the MCP server signs requests with whatever the attacker chose. The fallback chain itself is documented behavior; the *lack of validation in the fallback path* is the issue. |
| **NEW-6** | **P3** | **Doc/behavior mismatch on header families.** README, BUILD-SUMMARY.md, and ADR 0013 all assert that ANDROMEDA-only and LUMEN-only signed requests are accepted. The registry's `verifySignedRequest` wrapper rejects them. Net: existing buyers signing with X-Andromeda-* will see all their writes 401. |
| **NEW-7** | **P3** | **Control-plane bearer-token timing leak.** `mcp/control-plane.js:103` compares `token === _token` directly. Localhost-only mitigates impact. |
| **NEW-8** | **P3** | **Provider admin auth ignores rebrand chain.** `provider/src/lib/admin-auth.ts` reads only `LUMEN_ADMIN_USER` / `LUMEN_ADMIN_PASS`, not the AGORA / ANDROMEDA chain — so admin endpoints are silently disabled on a fresh AGORA install (the credentials never resolve). Same string also uses `!==` rather than `timingSafeEqual`. |

---

## 5. New defenses confirmed working

- **Family-pinning at the verifier:** once a family is selected by full-headers-present, the signature is validated *only* against that family. Cross-family confusion attacks (e.g. mixing `X-Agora-Pubkey` with `X-Andromeda-Sig`) are not exploitable.
- **Registry hard-pins to AGORA family at the wrapper level** (`registry/src/lib/sig.ts`). Even though the underlying verifier supports three families, the registry rejects ANDROMEDA-only / LUMEN-only requests with 401. This is *more secure than documented* — but, as noted, it breaks the documented backwards-compat story (NEW-6).
- **Macaroon resource-binding:** macaroons minted for `/v1/listing-verify` cannot be replayed at `/v1/order-receipt`, and provider macaroons cannot be replayed at the dataset-seller's `/purchase`.
- **Provider single-use macaroon enforcement:** atomic `pending → consumed` transition rejects double-spend with 409.
- **Mock-mode `/api/dev/pay` guard:** dataset-seller, market-monitor, and provider all return 404 when MOCK_MODE is false.
- **Migrations are non-destructive:** `~/.andromeda/` is preserved when `~/.agora/` is created.
- **CORS lockdown on control plane:** only one allowed dev origin (`http://localhost:5173`); `*` is not used; preflight from arbitrary origins returns 403.
- **`recordTransaction` idempotency:** SQLite `payment_hash UNIQUE` prevents duplicate-tx amplification of the same forged record.
- **Reviewer-pickedness check** in `submitReview`: a non-assigned reviewer cannot submit on someone else's review_request.
- **Buyer-cooldown on rating:** 30-day transaction window. Mostly ineffective because P0-1 forges the tx, but it's at least gating against pure-anonymous ratings.
- **Timing-safe macaroon HMAC compare** in both `provider/src/lib/l402.ts` and `packages/agora-core/src/l402.ts`.

---

## 6. Dependency scan results

`npm audit` per workspace (Node 20.19.0, npm v10):

| Workspace             | Vulns | Highest | Detail |
|-----------------------|-------|---------|--------|
| Root (`lumen`)        | 4     | moderate | esbuild ≤0.24.2 (GHSA-67mh-4wv8-2f99); postcss <8.5.10 in next (GHSA-qx2v-qp2m-jg93); vite ≤6.4.1 path-traversal (GHSA-4w7w-66w2-5vf9) |
| `provider/`           | 2     | moderate | postcss <8.5.10 via next |
| `registry/`           | 2     | moderate | postcss <8.5.10 via next |
| `web/`                | (same next/postcss) | moderate | postcss <8.5.10 via next |
| `mcp/`                | 0     | —        | clean |
| `dashboard/`          | 2     | moderate | esbuild + vite |
| `agents/dataset-seller/` | 0  | —        | no deps beyond node stdlib + better-sqlite3 |
| `agents/market-monitor/` | 0  | —        | same |
| `packages/agora-core/`   | 0  | —        | clean |

No HIGH or CRITICAL findings. The next/postcss XSS only matters if a registry or provider page renders untrusted HTML inside a `<style>`; the registry has no such surface, and the provider page is small. Vite/esbuild advisories are dev-server-only (dashboard).

---

## 7. Summary table

| Severity | Count | IDs |
|----------|-------|-----|
| P0       | 4     | P0-1, P0-2, P0-3, P0-4 (all still exploitable; P0-2 expanded to three header families) |
| P1       | 5     | P1-1, P1-2, P1-3, NEW-1, NEW-3 |
| P2       | 3     | NEW-2, NEW-4, NEW-5 |
| P3       | 3     | NEW-6, NEW-7, NEW-8 |

Notes:
- The rebrand pass introduced **no new fixes** to the carried-over P0/P1 list.
- The rebrand pass introduced **one direct regression** (P0-2 now spoofable across three header families instead of one) and surfaced several new issues, predominantly default-secret leakage and file-mode hygiene.
- The rebrand pass introduced **one improvement that is undocumented**: the registry's hard-AGORA-family pinning (NEW-6).

End of report. No fixes proposed (per audit brief).
