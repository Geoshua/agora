# Agora — Behavior Audit (post-MDK migration, ADR 0014)

Independent verification of `README.md`, `PAYMYAGENT.md`, and
`docs/BUILD-SUMMARY.md` after the L402 → MoneyDevKit (MDK) wire-format
migration (ADR 0014), the `dev-admin-secret`-fallback removal (commit
`d64ebcf`), the `@noble/*` import-path fixes (`e908a27`, `0486599`),
the new `/activity` page on the public web, and the new
`GET /api/v1/transactions/recent?limit=N` registry endpoint.

Code was read but not modified. Endpoints were probed manually with
`curl` and `node`. Test gates were run sequentially with explicit
`ADMIN_SECRET=dev-admin-secret` env var set, killing all node processes
between phases.

---

## 1. Summary

| Bucket | Pass | Fail | Notes |
|--------|-----:|-----:|-------|
| Phase test gates (test-phase0/1/1b/2/3/3-ui/4/5/6/7 + test-mcp + legacy phase1) | **11** | **1** | All ten fresh phases plus test-mcp pass on a clean clone, **provided** `ADMIN_SECRET` is exported AND phase 7's pre-requisites (registry + 3 sellers) are running first. Without `ADMIN_SECRET`, `test:phase5` drops to 14/17 and `test:phase6` to 10/11. Legacy `test-phase1.js` still 1/16. |
| Provider endpoints (port 3000) | **10** | 0 | The 3 previously-broken subscription sub-routes (`/topup`, `/cancel`, `/alerts`) **now respond correctly** — fixed since previous audit. |
| Registry endpoints (port 3030) | 18 + new endpoint | **1** | `X-Andromeda-*` and `X-Lumen-*` signed-request header families STILL not accepted on signed-write routes — same P0 bug as previous audit (`registry/src/lib/sig.ts:16`). |
| Market-monitor endpoints (port 3100), Dataset-seller (port 3200) | 15 | 0 | Unchanged; both report `agora-*` service IDs and `agora.directory.v1` schema. |
| MCP control plane (random port, 127.0.0.1) | 10 | 0 | Bearer + CORS + kill-switch all behave correctly. |
| MCP tools | 24 canonical + 24 `andromeda_*` + 7 `lumen_*` = **55 names** routing to **24 handlers** | — | Doc claims "23 + 14 = 37" → wrong on 4 numbers (carried over). |
| MDK macaroon-format compliance | PASS | — | Wire format byte-for-byte MDK-shape (`base64(JSON{paymentHash,amountSats,expiresAt,resource,amount,currency,sig})`). Soft-transition verifier accepts both MDK shape and legacy `base64url(json).hmac`. |
| Mock-mode integrity | PASS | — | `npm run demo:multi`: 360 sat round trip, 0 NWC outbound, no `mainnet.moneydevkit.com` egress. |

Net: **6 issues** of behavioural / doc impact.
- **1 P0** (carried over): registry rejects legacy header families.
- **2 P1** (carried over): `agora_purchase_dataset` real-mode unimplemented; provider `/api/health` and discovery/response headers still LUMEN-branded.
- **1 P1** (NEW): admin-secret env var is now mandatory for `test:phase5` + `test:phase6` to pass — they hard-code `dev-admin-secret` as the header but the registry now requires `ADMIN_SECRET=dev-admin-secret` set in the spawning env.
- **1 P1** (carried over): Legacy `test:phase1` 1/16 fail (admin creds env vars unset).
- Several P2 doc/consistency drifts.

The MDK migration itself is **clean**: wire format conforms to the spec in ADR 0014 §"Macaroon wire format", soft-transition verifier accepts both formats, mock-mode mints offline with no MDK account or network egress.

---

## 2. Test gate results

All gates were run with `ADMIN_SECRET=dev-admin-secret` set in the parent shell, after `npm install` + `cd packages/agora-core && npx tsc -p tsconfig.json`. Node processes were killed between phases.

| Script | Result | Doc claims | Notes |
|--------|--------|------------|-------|
| `test:phase0` | **PASS · 16/16** | PASS · 12/12 | Now 16 (added MDK byte-format + soft-transition + ADR 0014 + ADR 0013 ADR-file checks). |
| `test:phase1` (legacy) | **FAIL · 1/16** | "legacy single-provider, intact" | Still fails at step 7 — admin /stats 401 because `LUMEN_ADMIN_USER`/`LUMEN_ADMIN_PASS` aren't in `provider/.env.local`. Same as previous audit. **Note: this is documented as a known limitation in README.md "Known limitations".** |
| `test:phase1b` | **PASS · 20/20** | PASS · 16/16 | All 10 canonical agora_* + 10 andromeda_* + 7 lumen_* tools registered. The "registry still accepts legacy X-Andromeda-* family" check (line 129) is still a false positive — it asserts only HTTP 401 not the rejection reason; the actual reason is `"missing signature headers"` (the §3 P0 bug), not `"signature invalid"`. |
| `test:phase2` | **PASS · 13/13** | PASS · 12/12 | Subscriptions tested against the **market-monitor agent** (3100), not the provider's `/api/v1/subscriptions/*` routes. (Provider routes now also work — see §3.) |
| `test:phase3` | **PASS · 12/12** | PASS · 12/12 | Control plane on `~/.agora/`, kill-switch end-to-end. |
| `test:phase3-ui` | **PASS · 16/16** | PASS · 16/16 | Dashboard build + 5 control-plane proxies + CORS allow-list. |
| `test:phase4` | **PASS · 13/13** | PASS · 11/11 | Orchestrator weights 0.6/0.2/0.2, both alias families. |
| `test:phase5` | **PASS · 17/17 (with ADMIN_SECRET)** ; **FAIL · 14/17 (without)** | PASS · 16/16 | **Working-convention quirk:** test hard-codes `x-admin-secret: dev-admin-secret` but registry now requires `ADMIN_SECRET=dev-admin-secret` to be exported in the spawning shell. Without it, `/admin/fast-forward` and `/admin/decay` calls return 503. |
| `test:phase6` | **PASS · 11/11 (with ADMIN_SECRET)** ; **FAIL · 10/11 (without)** | PASS · 10/10 | Same root cause — `/api/v1/platform/revenue` requires admin auth. |
| `test:phase7` | **PASS · 14/14** *only when registry + provider already booted with seller registered* | PASS · 14/14 | Order-dependent (carried over from previous audit). When run cleanly with the 3 sellers registered first, all 14 pass. |
| `test:mcp` | **PASS · 12/12** | PASS · 12/12 | `lumen_*` aliases reach the same handler. |

All scripts genuinely test their phase's deliverable (each was read end-to-end).

### NEW working-convention quirks (not bugs, but undocumented)

1. **Tests with `dev-admin-secret` need `ADMIN_SECRET` env set.** After commit `d64ebcf` removed the dev fallback in `registry/src/lib/admin.ts:11`, admin endpoints return 503 ("admin endpoints disabled (ADMIN_SECRET not set or too short)") when no `ADMIN_SECRET` is in the registry's process env. `test:phase5` and `test:phase6` continue to send `x-admin-secret: dev-admin-secret` but expect the registry it spawns to accept it. The fix the operator must apply is to export `ADMIN_SECRET=dev-admin-secret` in the parent shell — it propagates via the test scripts' `{ ...process.env }` env clone. Neither README nor BUILD-SUMMARY documents this; the test scripts do not assert it.
2. **`test:phase7` requires registry + sellers running first.** The script's docstring says "spawns the web app against the live registry" — but it does not seed the registry. If the registry has zero sellers, `sellers.sellers.find(s => s.name === "vision-oracle-3")?.pubkey` is undefined and `/sellers/[pubkey]` is fetched as `/sellers/undefined`, producing a 404 instead of the expected page. (Carried over from previous audit.)

---

## 3. Endpoint compliance (provider · port 3000)

| Method | Path | Documented | Actual | Notes |
|--------|------|-----------|--------|-------|
| GET | `/api/health` | free, JSON | **PARTIAL** | `service:"lumen-provider"` (still). `agora_pubkey` AND `andromeda_pubkey` both present (rebrand-1 backward-compat).  |
| GET | `/api/v1/discovery` | schema `agora.directory.v1` | **PARTIAL** | Schema string is still `"lumen.directory.v1"`. Provider was missed in the rebrand (market-monitor + dataset-seller correctly emit `agora.directory.v1`). |
| GET | `/api/v1/stats` | basic-auth | **PARTIAL** | Closed-by-default: `WWW-Authenticate: Basic realm="lumen-admin"`; with creds returns `{"error":"unauthorized","message":"admin disabled (set LUMEN_ADMIN_USER / LUMEN_ADMIN_PASS)"}`. Realm + error message still LUMEN-prefixed. |
| GET | `/api/v1/receipts/{id}` | none, free | **MATCH** | Unknown id → 404 envelope. |
| POST | `/api/v1/listing-verify` | L402, 240 sat | **MATCH (with header drift)** | 402 challenge mints **MDK-shape** macaroon (verified §6). Response headers still `X-Lumen-Amount-Sats` / `X-Lumen-Resource`. Successful replay sets `x-agora-l402-family: mdk` (NEW). |
| POST | `/api/v1/order-receipt` | L402, 120 sat | **MATCH (same header drift)** | Same MDK-shape mint, same response headers. |
| POST | `/api/dev/pay` | mock-only | **MATCH** | Unknown payment_hash → 404. |
| POST | `/api/v1/subscribe` | trust-deposit | **MATCH** | Returns subscription_id, balance_sats, status="active". |
| GET | `/api/v1/subscriptions/:id` | none | **MATCH** | Returns full sub object. (Previous audit flagged inconsistent error envelope; spot-check shows envelope is now consistent.) |
| **POST** | **`/api/v1/subscriptions/:id/topup`** | mock-paid | **WORKS** (was BROKEN in previous audit) | Accepts `{"sats":<int>}`. Returns `{ok, subscription_id, balance_sats, status}`. **Fixed since previous audit.** |
| **POST** | **`/api/v1/subscriptions/:id/cancel`** | refund | **WORKS** (was BROKEN) | Returns `{ok, subscription_id, refunded_sats, status:"cancelled"}`. **Fixed.** |
| **GET** | **`/api/v1/subscriptions/:id/alerts?since=`** | none | **WORKS** (was BROKEN) | Returns `{subscription_id, since, alerts[], count}`. **Fixed.** |
| POST | `/api/dev/fire-alert` | mock-only | **MATCH** | 400 on missing fields. |

Provider macaroon `docs` URL still points to `https://github.com/ouazmourad/lumen#errors` (personal fork). Cosmetic.

---

## 4. Endpoint compliance (registry · port 3030) — including new transactions/recent

19 documented endpoints + 1 new (`/api/v1/transactions/recent`). 18 OK, 1 NEW endpoint OK, 1 carried-over P0 bug.

### 4.1 NEW endpoint: `GET /api/v1/transactions/recent?limit=N`

| Probe | Result |
|-------|--------|
| `GET /api/v1/transactions/recent?limit=5` | **200** + `{schema:"agora.transactions.v1", count, transactions[]}`. Cache-Control `public, max-age=2, s-maxage=2`. |
| `GET /api/v1/transactions/recent` (no param) | 200, default limit 50. |
| `GET /api/v1/transactions/recent?limit=0` | 200 — DB clamps `Math.max(1, Math.min(200, limit))` → returns 1 row anyway, **with `count:1`** (caller's "limit=0" intent is silently overridden). |
| `GET /api/v1/transactions/recent?limit=-5` | 200 — same clamp → 1 row. |
| `GET /api/v1/transactions/recent?limit=1000` | 200 — clamps to 200. |
| `GET /api/v1/transactions/recent?limit=abc` | 200 — `parseInt("abc")` is NaN → falls back to 50 (route handles). |
| Schema `agora.transactions.v1` declared | YES. |
| Field set per row | `id`, `buyer_pubkey` (full 64-hex), `seller_pubkey` (full 64-hex), `seller_name`, `service_id`, `service_name`, `amount_sats`, `platform_fee_sats`, `payment_hash` (full 64-hex), `settled_at`. |
| Auth | None (public). |
| Documented in `docs/BUILD-SUMMARY.md` | NO — endpoint is **not** in the registry endpoint table. P2 doc gap. |
| Documented in `docs/audit-design.md` | YES (S-6, flagged as MEDIUM privacy concern). |

The endpoint behaves as advertised — it's stable, consistent, and returns sensible JSON. The clamping of negative/zero limits to 1 is silent (no validation error response), which is functionally fine but slightly unobvious.

### 4.2 Web `/activity` page

`http://localhost:3300/activity` returns HTTP 200 (verified post-build). Renders server-side via `revalidate = 0`. Reads from `/api/v1/transactions/recent`.

### 4.3 Carried-over P0: registry rejects `X-Andromeda-*` / `X-Lumen-*` signed headers

`registry/src/lib/sig.ts:16` short-circuits with `"missing signature headers"` if **canonical** `x-agora-pubkey` / `x-agora-sig` / `x-agora-timestamp` headers are missing. The shared `verifyRequest()` (which DOES iterate AGORA → ANDROMEDA → LUMEN families and is correctly tested by `@agora/core` smoke) is never reached.

Reproduction (registry running on :3030):

```
$ curl -i -X POST http://localhost:3030/api/v1/sellers/register \
       -H 'X-Andromeda-Pubkey: e72…' \
       -H 'X-Andromeda-Timestamp: 1777174000000' \
       -H 'X-Andromeda-Sig: deadbeef' \
       -H 'Content-Type: application/json' \
       -d '{"name":"x","url":"http://x"}'
HTTP/1.1 401 Unauthorized
{"error":"missing signature headers"}

$ curl -i -X POST http://localhost:3030/api/v1/sellers/register \
       -H 'X-Lumen-Pubkey: e72…' …
HTTP/1.1 401 Unauthorized
{"error":"missing signature headers"}
```

Compare with the AGORA family (passes the gate, fails at the next check):

```
$ curl -i -X POST http://localhost:3030/api/v1/sellers/register \
       -H 'X-Agora-Pubkey: e72…' …
HTTP/1.1 401 Unauthorized
{"error":"timestamp outside ±5min window"}
```

Affected routes (all 7 signed-write registry endpoints):
- `POST /api/v1/sellers/register`
- `POST /api/v1/sellers/:pubkey/rate`
- `POST /api/v1/transactions/record`
- `POST /api/v1/reviewers/availability`
- `POST /api/v1/reviews/request`
- `POST /api/v1/reviews/:id/submit`
- `POST /api/v1/reviews/:id/dispute`

Contradicts:
- BUILD-SUMMARY.md §"Endpoints (Registry)" *"Every Ed25519-signed endpoint accepts X-Agora-* (canonical), X-Andromeda-*, AND X-Lumen-* header families on incoming requests."*
- ADR 0013's backward-compat promise.
- README.md *"Every signed write accepts the X-Agora-* header family (canonical), with X-Andromeda-* and X-Lumen-* accepted as deprecated aliases on incoming."*

`scripts/test-phase1b.js:129` is supposed to catch this, but the test only asserts `status === 401`, not the error reason. Both `"missing signature headers"` and `"signature invalid"` produce 401, so the bug slips through.

### 4.4 Other registry endpoints

| Endpoint | Probe | Result |
|----------|-------|--------|
| `GET /api/v1/health` | no auth | 200, `service:"agora-registry"` |
| `GET /api/v1/sellers` | no auth | 200, array |
| `GET /api/v1/sellers/<bogus>` | no auth | 404 `no such seller` |
| `GET /api/v1/sellers/<pubkey>/stats` | no auth | 200 |
| `GET /api/v1/services` | no auth | 200 |
| `GET /api/v1/services/search?q=verification` | no auth | 200 + filtered |
| `POST /api/v1/orchestrator/recommend` | no auth | 200 with weights |
| `POST /api/v1/orchestrator/recommend` (no intent) | no auth | 400 `intent (string ≥2 chars) required` |
| `GET /api/v1/reviews/assigned` (no `reviewer_pubkey`) | no auth | 400 |
| `POST /api/v1/admin/decay` (no x-admin-secret, no ADMIN_SECRET env) | — | **503** `admin endpoints disabled (ADMIN_SECRET not set or too short)` (NEW behaviour post-d64ebcf) |
| `POST /api/v1/admin/decay` (no x-admin-secret, with ADMIN_SECRET env) | — | 401 `unauthorized` |
| `POST /api/v1/admin/decay` (correct x-admin-secret + ADMIN_SECRET env) | — | 200 |
| `POST /api/v1/admin/fast-forward` | — | same secret-or-503 pattern |
| `GET /api/v1/platform/revenue` | — | same |
| **`GET /api/v1/transactions/recent`** | no auth | **200, NEW** (see §4.1) |

Registry uses `{"error":"<message>"}` envelope. Provider uses `{error, message, request_id, docs}`. Drift carried over (P2).

---

## 5. Endpoint compliance (market-monitor · 3100, dataset-seller · 3200)

Both agents are plain Node `http` servers. All documented endpoints respond. Both report `service:"agora-market-monitor"` / `service:"agora-dataset-seller"` and emit `schema:"agora.directory.v1"` correctly. (Only the provider was missed in the rebrand — see §3.)

---

## 6. MDK macaroon-format compliance

### 6.1 Wire format verified

Captured a 402 challenge from an unauthenticated `POST /api/v1/listing-verify`:

```
WWW-Authenticate: L402 macaroon="<base64>", invoice="lnbcMOCK240u…"
```

Decoding the macaroon (`base64` → utf8 JSON):

```json
{
  "paymentHash": "5130023f0708fbc68217769263e0ba488c814c0d326e58b4e47afeff747c4966",
  "amountSats": 240,
  "expiresAt": 1777204749,
  "resource": "POST:/v1/listing-verify",
  "amount": 240,
  "currency": "SAT",
  "sig": "14f9a21a3d7e806383a6ec6e44aaf204f2a0bd6238abe77794387baa1900b64b"
}
```

Matches ADR 0014 §"Macaroon wire format" exactly:
- `base64` (not base64url) of one JSON blob.
- `sig` is **inside** the JSON.
- `paymentHash`, `amountSats`, `expiresAt` are camelCase (per MDK spec).
- `resource` is `<METHOD>:<path>` canonical form.
- 64-hex `sig`.

### 6.2 MDK-shape pay/replay round-trip

```
$ curl -X POST .../api/dev/pay -d '{"payment_hash":"5130023f…"}'
→ {"paid":true,"preimage":"a0ec4e3f…"}

$ curl -X POST .../api/v1/listing-verify \
       -H "Authorization: L402 <macaroon>:<preimage>" \
       -d '{"listing":"Berlin","date":"2026-04-27"}'
HTTP/1.1 200 OK
x-agora-l402-family: mdk
{"verified":true,...}
```

The new response header `x-agora-l402-family: mdk` confirms the verifier identified the macaroon as MDK-shape on this path.

### 6.3 Legacy-shape verifier (soft-transition compat) verified

Synthesized a `base64url(json).hmac` legacy-format macaroon for a freshly-issued payment_hash (using `mintMacaroonLegacy` from `@agora/core`, signed with the same `L402_SECRET` from `provider/.env.local`):

```
$ node packages/agora-core/dist/index.js (script)
challenge: 402
payment_hash: e879756cdc2384db…
preimage:     86c3904f175e8485…
legacy macaroon: eyJwYXltZW50X2hhc2giOiJlODc5NzU2…  (note: starts with base64url-of-snake_case-JSON)
legacy replay status: 200
x-agora-l402-family: legacy
```

200 OK, header `x-agora-l402-family: legacy`. **Soft-transition verifier confirmed: both MDK-shape and legacy-shape macaroons verify against the same provider/secret.**

### 6.4 Tampered macaroon rejection

Smoke test (`@agora/core/test/smoke.test.mjs:242`) asserts that flipping `amountSats` in an MDK-shape macaroon body without re-signing causes `verifyMacaroon` to return null. Verified by running the smoke test (passes — part of `test:phase0`).

### 6.5 MDK macaroon-format compliance verdict: **PASS**

The seller-side L402 mint/verify is byte-compatible with `@moneydevkit/core/mdk402/token.js`'s public token format (per ADR 0014 §"Recon"). The buyer side treats the macaroon as opaque (per ADR 0014 §"Buyer side"), so the migration is invisible to MCP clients. Soft-transition verifier accepts both shapes for the deprecation window.

Key strength: the offline shim in `packages/agora-core/src/l402.ts` produces wire-bytes-identical macaroons using only Node stdlib (`createHmac`, `createHash`, `Buffer`, `timingSafeEqual`) — no `@moneydevkit/*` dep is loaded in mock mode. Confirmed by inspection.

Key caveat (carried over from ADR 0014 §"Known limitations"): the full `@moneydevkit/nextjs/server.withPayment` adoption in real mode is still pending; today, real-mode (`MOCK_MODE=false` + `MDK_ACCESS_TOKEN` + `MDK_MNEMONIC`) reuses the in-house wallet adapter for invoice issuance and the MDK wire format for the macaroon. ADR 0014 documents this explicitly; not a behavioural bug. (Independently flagged by `audit-design.md` and `audit-security.md` MDK-3.)

---

## 7. MCP tool compliance

**Counts:** `mcp/server.js` registers **24 canonical `agora_*`** tools. Each has an `andromeda_*` alias (24 of them). Seven of them additionally have `lumen_*` aliases.

- 24 + 24 + 7 = **55 registered names**.
- 24 unique handlers (each `agora_*` registered handler is reused by aliases).

BUILD-SUMMARY.md §"MCP tools" claims:

> 23 canonical `agora_*` tools + 14 deprecated aliases (`andromeda_*` for all 23, `lumen_*` for the original 7) = **37 registered names** routing to **23 unique handlers**.

Off by 4 numbers (carried over):
- **23** canonical → **24** (the doc's own table actually lists 24).
- **14** deprecated aliases → **31**.
- **37** total → **55**.
- **23** unique handlers → **24**.

### Per-tool table

| Canonical | Andromeda alias | Lumen alias | Cost (doc) | Cost (code) | OK? |
|-----------|:---:|:---:|------------|-------------|:---:|
| `agora_status` | yes | yes | free | free | ok |
| `agora_discover` | yes | yes | free | free | ok |
| `agora_balance` | yes | yes | free | free | ok |
| `agora_set_budget` | yes | yes | free | free | ok |
| `agora_verify_listing` | yes | yes | ~240 sat | challenge served at 240 (MDK-shape macaroon) | ok |
| `agora_file_receipt` | yes | yes | ~120 sat | 120 sat | ok |
| `agora_fetch_receipt` | yes | yes | free | free | ok |
| `agora_search_services` | yes | — | free | free | ok |
| `agora_list_sellers` | yes | — | free | free | ok |
| `agora_discover_all` | yes | — | free | free | ok |
| `agora_recommend` | yes | — | free | free | ok |
| `agora_subscribe` | yes | — | mock-deposit | trust-deposit | ok |
| `agora_list_subscriptions` | yes | — | free | free | ok |
| `agora_check_alerts` | yes | — | free | free | ok |
| `agora_topup_subscription` | yes | — | mock-deposit | mock-paid | ok |
| `agora_cancel_subscription` | yes | — | refund | refund | ok |
| `agora_rate_seller` | yes | — | free (signed) | free (signed) | ok |
| `agora_request_review` | yes | — | escrow | escrow | ok |
| `agora_set_reviewer_availability` | yes | — | free (signed) | free (signed) | ok |
| `agora_check_review_assignments` | yes | — | free | free | ok |
| `agora_submit_review` | yes | — | free (signed) | free (signed) | ok |
| `agora_browse_datasets` | yes | — | free | free | ok |
| `agora_purchase_dataset` | yes | — | 5000 sat (NOAA) | mock works; **real-mode early-returns "not implemented" (`mcp/server.js:685`)** | **partial** (carried over) |
| `agora_list_datasets` | yes | — | free | free | ok |

### Dual-alias verification — PASS

For every `agora_*` canonical, the `andromeda_*` is registered via the same `registerWithAliases()` helper (`mcp/server.js:57`). Each alias's `description` is prefixed with `[deprecated alias of <canonical> — will be removed in a future release]`. Each handler reference is identical.

For each of the original 7, the `lumen_*` alias is registered the same way.

`test-phase1b.js` and `test-mcp.js` exercise both alias families end-to-end. `test-mcp.js` deliberately uses `lumen_*` aliases on every paid call to prove they reach the same handler.

---

## 8. Mock-mode verification

`MOCK_MODE=true` is the default in `provider/.env.local` and `buyer/.env`. Ran `npm run demo:multi`:

```
listing-verify  240 sat  105 ms
order-receipt   120 sat   61 ms
total spent     360 sat
total fees        0 sat
round trip      254 ms
done — two services, one wallet, no human.
```

All traffic was `localhost:3000`. No network egress.

Source review:
- `provider/src/lib/wallet.ts` — `nwcClient()` is the only `NWCClient` constructor, gated behind `wallet()` selector that returns the mock branch when `MOCK_MODE === "true"`. Real branch never instantiated in mock.
- `buyer/lumen.js` — `ln()` returns no client in mock; `pay()` hits `/api/dev/pay`.
- `mcp/lumen-client.js` — same pattern.
- `packages/agora-core/src/l402.ts` — uses `node:crypto` only; no `@moneydevkit/*` import. Verified by reading the full file.
- `provider/src/lib/l402.ts` — re-exports `mintMacaroon` / `verifyAuth` from `@agora/core`. No `@moneydevkit/*` import. Verified.

Top-level `import { NWCClient } from "@getalby/sdk"` does not open a connection; the class is only constructed inside the real-mode helper. Confirmed.

`grep -r 'moneydevkit\.com'` across all `*.ts`/`*.js`/`*.mjs` finds **zero runtime references** — the only hit is a documentation comment in `provider/src/lib/l402.ts:26`. No `mainnet.moneydevkit.com` egress in mock mode.

**Mock-mode integrity: PASS.**

---

## 9. Status of previous audit's bugs

| Previous audit's bug | Status | Evidence |
|----------------------|--------|----------|
| **3 dead provider subscription routes** (`/topup`, `/cancel`, `/alerts`) returned Next.js HTML 404 | **FIXED** | curl probes (§3) return JSON 200/400/409 envelopes. `provider/src/app/api/v1/subscriptions/[id]/{topup,cancel,alerts}/route.ts` files exist and route correctly. |
| **`agora_purchase_dataset` silently mock-only in real mode** | **STILL PRESENT** | `mcp/server.js:685` still has `return fail("real-mode dataset payment not implemented in MCP yet (NWC route)")`. Doc table promises 5000 sat real-mode payment; only mock works. |
| **Legacy `test-phase1.js` fails 1/16 on clean clone** (admin creds env vars unset) | **STILL PRESENT** | Re-ran on this clone; `FAIL · 1 of 16 checks failed` at step 7. Error message still references `LUMEN_ADMIN_USER / LUMEN_ADMIN_PASS`. |
| **Registry rejects `X-Andromeda-*` / `X-Lumen-*` signed headers** despite ADR 0013 promise | **STILL PRESENT** | `registry/src/lib/sig.ts:16` still has the canonical-only gate. Repro in §4.3. The fix would be a one-line change (delete the `if (!headers[HDR_PUBKEY] || …)` short-circuit and rely on `verifyRequest()` to find a family) but has not been applied. |

**1 of 4 fixed; 3 still present.** Net P0 count down by 0 (the carry-over P0 is still present; the previously-P0 broken provider sub-routes are fixed but were not the P0 in the previous report — that P0 was the registry header bug, which remains).

---

## 10. New bugs found, severity-ranked

### P0 · Registry rejects `X-Andromeda-*` and `X-Lumen-*` signed headers (carried over)

See §4.3. Same root cause as previous audit. Same code at `registry/src/lib/sig.ts:16`. Same scope (7 signed-write registry routes). Same false-positive coverage in `test-phase1b.js:129`. **No change since previous audit.**

### P1 · `agora_purchase_dataset` real-mode unimplemented (carried over)

`mcp/server.js:685`: `return fail("real-mode dataset payment not implemented in MCP yet (NWC route)");`

PAYMYAGENT.md §"5 · Flip to real Lightning" warns about this in a footnote. README.md "Known limitations" warns about this. BUILD-SUMMARY.md "Known limitations" still does NOT list this — it remains "honestly limited" only in two of three top-level docs.

### P1 · Provider was not fully rebranded (carried over)

The provider still emits:
- `/api/health` → `"service":"lumen-provider"` (should be `"agora-provider"`)
- `/api/v1/discovery` → `"schema":"lumen.directory.v1"` (should be `agora.directory.v1`; market-monitor + dataset-seller correctly emit it)
- 402 challenges → `X-Lumen-Amount-Sats` / `X-Lumen-Resource` response headers
- `/api/v1/stats` → `WWW-Authenticate: Basic realm="lumen-admin"` and `LUMEN_ADMIN_USER / LUMEN_ADMIN_PASS` env-var error message

ADR 0013 / BUILD-SUMMARY explicitly list service identifier renames in the rebrand checklist. This is **not** in any "Known limitations" list.

### P1 · Legacy `test-phase1.js` still fails 1/16 (carried over)

Same root cause as previous audit. README's "Known limitations" calls it out, but BUILD-SUMMARY.md still labels it `(legacy single-provider, intact)` — "intact" remains misleading.

### P1 (NEW) · `test:phase5` and `test:phase6` silently fail without `ADMIN_SECRET=dev-admin-secret`

After commit `d64ebcf` removed the `dev-admin-secret` fallback in `registry/src/lib/admin.ts:11`, admin endpoints return 503 unless the registry's process env contains a 16+-char `ADMIN_SECRET`. The two test scripts hard-code `x-admin-secret: dev-admin-secret` as the request header but never check that the spawning shell actually exports `ADMIN_SECRET=dev-admin-secret`.

Reproduction:

```
$ unset ADMIN_SECRET
$ npm run test:phase5
…
  FAIL · fast-forward: {"error":"admin endpoints disabled (ADMIN_SECRET not set or too short)"}
  FAIL · decay: {"error":"admin endpoints disabled (ADMIN_SECRET not set or too short)"}
  FAIL · decay value wrong: before=2 after=2
  ok · all 5 canonical agora_* review tools registered
  ok · all 5 legacy andromeda_* review aliases registered
FAIL · 14/17

$ unset ADMIN_SECRET
$ npm run test:phase6
…
  FAIL · platform revenue: {"error":"admin endpoints disabled (ADMIN_SECRET not set or too short)"}
…
FAIL · 10/11
```

This is a behaviour regression from the previous audit (those tests passed without any pre-set env). It is not a code bug — the deploy commit's intent was correct (fail-secure on production registries) — but it IS a **broken contract between the test scripts and their dependencies**. README.md / BUILD-SUMMARY.md / CHANGELOG.md do not mention that an `ADMIN_SECRET` env is now needed for these gates. The test scripts themselves do not assert this dependency or set the env in their `spawn()` calls.

### P2 · BUILD-SUMMARY MCP tool counts wrong by 4 numbers (carried over)

"23 canonical + 14 deprecated = 37 routing to 23 handlers" → actual: **24 canonical + 31 deprecated = 55 routing to 24 handlers**.

### P2 (NEW) · `GET /api/v1/transactions/recent` not in BUILD-SUMMARY endpoint table

The endpoint exists, returns clean JSON, is consumed by `web/src/app/activity/page.tsx`, and is documented in `docs/audit-design.md`. But it is missing from BUILD-SUMMARY.md §"Endpoints (Registry)". README.md mentions a public web index but doesn't list `/activity`. Independent ADRs reference the activity feed but BUILD-SUMMARY's endpoint inventory is now stale.

### P2 (NEW) · `transactions/recent` silently overrides invalid limits

`?limit=0`, `?limit=-5`, `?limit=abc` all return 200 with the default behaviour (1 row for the negative/zero clamp; 50 for the NaN parse). No 400 response. Caller's intent is silently ignored. Functionally fine, but breaks the "validate inputs, return 400 on bad" pattern used by `POST /api/v1/orchestrator/recommend` and `GET /api/v1/reviews/assigned`.

### P2 · `test-phase7.js` is order-dependent (carried over)

Phase 7 has not been changed to seed its own registry data. Still requires the registry to already have `vision-oracle-3` registered.

### P2 · `test-phase1b.js` step 5 false positive (carried over)

The script verifies tampered legacy `X-Andromeda-*` request returns 401 but does not check the response body's `error` field. The §4.3 P0 bug would be caught if this assertion checked `error === "signature invalid"` instead of just `status === 401`.

### P2 · Provider error envelope still inconsistent (carried over)

Some provider routes return `{error, message, request_id, docs}`; a few hand-rolled ones return only `{"error":"..."}`. Carried.

### P2 · Registry vs provider error envelope drift (carried over)

Registry: `{"error":"<message>"}`. Provider: `{error, message, request_id, docs}`. Carried.

### P2 · Macaroon `docs` URL points to personal fork (carried over)

`https://github.com/ouazmourad/lumen#errors`. Cosmetic.

---

## 11. Discrepancies between docs and code

D1. **README.md "Endpoints" table** still lists only 5 provider endpoints. No mention of `/api/v1/stats`, `/api/v1/receipts/{id}`, `/api/v1/subscribe`, `/api/v1/subscriptions/*`, `/api/dev/fire-alert`, or the new `transactions/recent` registry endpoint. (Carried over.)

D2. **PAYMYAGENT.md** describes only the original 7 tools in the install walkthrough; says "Twelve checks; should print PASS · 12/12" matching `test-mcp.js`. The 23-tool table is in the §"23 canonical agora_* tools" header but the doc title still says **23**, not **24**. (Carried.)

D3. **BUILD-SUMMARY.md** "23 canonical / 14 aliases / 37 names / 23 handlers" — wrong on all four numbers (P2 above).

D4. **BUILD-SUMMARY.md** lists `test-phase1.js` as "(legacy single-provider, intact)". Not intact — fails 1/16 on clean clone.

D5. **BUILD-SUMMARY.md** §"How to run end-to-end" lists `test-phase7` as expecting the registry running, but doesn't say the registry must already have a seller registered. On a fresh registry, phase 7 fails 9/14.

D6. **BUILD-SUMMARY.md** §"Endpoints (Registry)": *"Every Ed25519-signed endpoint accepts X-Agora-*, X-Andromeda-*, AND X-Lumen-* header families on incoming requests."* — registry actually accepts ONLY `X-Agora-*`. P0 above.

D7. **BUILD-SUMMARY.md** §"Branding history": *"Service identifiers in `/api/health` | `andromeda-registry` etc. → `agora-registry` etc. | Just renamed"* — the provider's `/api/health` `service` field is still `"lumen-provider"`. Missed.

D8. **BUILD-SUMMARY.md** §"Branding history": *"Discovery schema → `agora.directory.v1` | Parser accepts both"* — provider emits `lumen.directory.v1`, which is in NEITHER list.

D9. **BUILD-SUMMARY.md** §"Known limitations" still has 8 items. Should list (a) `agora_purchase_dataset` real-mode unimplemented, (b) `test:phase5` / `test:phase6` require `ADMIN_SECRET` env.

D10. **BUILD-SUMMARY.md** §"Endpoints (Registry)" table does not include `GET /api/v1/transactions/recent`. (NEW P2.)

D11. **README.md / PAYMYAGENT.md** instruct users to set `LUMEN_PROVIDER_URL` etc. but the legacy admin-creds env vars (`LUMEN_ADMIN_USER` / `LUMEN_ADMIN_PASS`) are not documented anywhere; `provider/.env.local` ships without them.

D12. **CHANGELOG.md** says `MDK_ACCESS_TOKEN` and `MDK_MNEMONIC` are real-mode env vars but no script enforces their presence — `MOCK_MODE=false` without them silently uses the in-house wallet adapter and HMAC-keyed-by-`L402_SECRET`. ADR 0014 acknowledges this as the documented next step. Not a regression but worth flagging because the security/design audits also mention it.

D13. **README.md "Known limitations"** section is honest about most issues (Tauri stub, embeddings, sub-routes-broken note for provider) and explicitly mentions audit findings remain open. The mention of "3 broken provider routes" is now stale — those routes work.

---

## 12. New tests / coverage worth adding (not bugs, just observations)

- A test that asserts `X-Andromeda-Pubkey: <valid signed>` is accepted by the registry. (Would catch §4.3 P0.)
- A test that asserts `?limit=0` and `?limit=-5` on `/transactions/recent` return either an empty list or a 400, not the default page. (Would catch §10 silent-override.)
- A test that asserts `test:phase5` / `test:phase6` fail loudly when `ADMIN_SECRET` is not set, OR set it themselves in `spawn()`. (Would prevent §10 NEW P1.)
- A test that asserts the provider's `/api/health` `service` field is `agora-provider`. (Would catch §3 P1.)
- A test that asserts the provider's discovery schema is `agora.directory.v1` OR `andromeda.directory.v1`. (Would catch §3 P1.)

---

End of audit.
