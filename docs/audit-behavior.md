# Agora — Behavior Audit (post-rebrand to Agora, ADR 0013)

Independent verification of `README.md`, `PAYMYAGENT.md`, and
`docs/BUILD-SUMMARY.md` after the second rebrand (Andromeda → Agora).
Code was read but not modified. Endpoints were probed manually with
`curl`. MCP tool registry was diffed against the doc table by reading
`mcp/server.js`. Test gates were run sequentially from a clean port
state with `MOCK_MODE=true` (default).

---

## 1. Summary

| Bucket | Pass | Fail | Notes |
|--------|-----:|-----:|-------|
| Phase test gates (test-phase0/1/1b/2/3/3-ui/4/5/6/7 + test-mcp + legacy phase1) | **10** | **2** | `test-phase1.js` (legacy) still 1/16 fail. `test-phase7.js` is order-dependent — fails 9/14 if run before phase1b/provider boot, passes 14/14 if run after. |
| Provider endpoints (port 3000) | 7 | **3** | `POST /api/v1/subscriptions/:id/topup`, `POST /api/v1/subscriptions/:id/cancel`, `GET /api/v1/subscriptions/:id/alerts` still return Next.js HTML 404. |
| Registry endpoints (port 3030) | 18 | **1** | `X-Andromeda-*` and `X-Lumen-*` signed-request header families are NOT actually accepted on incoming requests, contrary to ADR 0013 / BUILD-SUMMARY claims. New P0. |
| Market-monitor endpoints (port 3100), Dataset-seller (port 3200) | 15 | 0 | Unchanged from previous audit; agents are plain Node http servers, all routes responsive. |
| MCP control plane (random port, 127.0.0.1) | 10 | 0 | All paths present, bearer auth + CORS scope enforced. |
| MCP tools | 24 canonical + 24 `andromeda_*` + 7 `lumen_*` = **55 names** routing to 24 handlers | — | Doc claims "23 + 14 = 37" → both numbers wrong (off-by-one canonical count carried over from previous audit; alias-count math wrong post-rebrand). |
| Mock-mode integrity | PASS | — | `npm run demo:multi` ran end-to-end in 888 ms with no NWC traffic. `@getalby/sdk` constructors are gated behind `MOCK` checks in all three callers (provider, buyer, mcp). |

Net: **5 issues**. **2** at P0 (3 provider sub-routes still broken; new — registry rejects legacy header families despite the documented backwards-compat). **2** at P1 (`agora_purchase_dataset` real-mode unimplemented; legacy `test-phase1.js` 1/16 fail). Several P2 doc / consistency drift issues, including new ones from the rebrand (provider service id + discovery schema not updated to Agora).

---

## 2. Test gate results

| Script | Run result | Doc claims | Verdict |
|--------|------------|------------|---------|
| `scripts/preflight.js` | not run (legacy real-mode setup probe) | "legacy, intact" | not a phase gate |
| `scripts/test-phase0.js` | **PASS · 15/15** | PASS · 12/12 | Matches (or better — gate has grown to 15 checks: ADR 0013 ADR file, legacy `packages/andromeda-core` removal check, AGORA env var fallback, AGORA + ANDROMEDA + LUMEN signed-request header constants exported all present). |
| `scripts/test-phase1.js` (legacy) | **FAIL · 1/16** — step 7 admin /stats returns 401 because `LUMEN_ADMIN_USER`/`LUMEN_ADMIN_PASS` env vars not set on clean clone | "legacy single-provider, intact" | **Still broken** — same failure mode as previous audit. |
| `scripts/test-phase1b.js` | **PASS · 20/20** | PASS · 16/16 | 4 extra checks added (canonical agora_* tools, andromeda_* aliases, lumen_* aliases, legacy x-andromeda-* tamper path). All pass. **Caveat:** the "registry still accepts legacy X-Andromeda-* family" check is a false positive — see §4. The test sends a request with bad-but-present `x-andromeda-*` headers and expects 401 on tamper; it gets 401, BUT the rejection reason is `"missing signature headers"` not `"signature invalid"`, meaning the legacy family is rejected unconditionally. The test never inspects the reason field, so the bug slips through. |
| `scripts/test-phase2.js` | **PASS · 13/13** | PASS · 12/12 | Tests subscriptions against the **market-monitor agent** (port 3100, plain Node http), NOT the provider's `/api/v1/subscriptions/:id/*` routes (which remain broken — see §3). |
| `scripts/test-phase3.js` | **PASS · 12/12** | PASS · 12/12 | Match. Control plane on `~/.agora/`, kill-switch flips a paid call from 200 to refused. |
| `scripts/test-phase3-ui.js` | **PASS · 16/16** | PASS · 16/16 | Match. CORS preflight from `localhost:5173` accepted, from `evil.com` blocked, dashboard SPA build clean, 5 control-plane paths in bundle. |
| `scripts/test-phase4.js` | **PASS · 13/13** | PASS · 11/11 | Match — and slightly more thorough than doc'd. |
| `scripts/test-phase5.js` | **PASS · 17/17** | PASS · 16/16 | Match. |
| `scripts/test-phase6.js` | **PASS · 11/11** | PASS · 10/10 | Match. Mock-only path. Real-mode unimplemented (P1). |
| `scripts/test-phase7.js` | **PASS · 14/14** when registry already has provider self-registered; **FAIL · 9/14** otherwise | PASS · 14/14 (claimed) | **Order-dependent** — see §10 D6 below. |
| `scripts/test-mcp.js` | **PASS · 12/12** | PASS · 12/12 | Match. Uses `lumen_*` aliases on purpose. |

All scripts genuinely test their phase's deliverable (each was read end-to-end). The only non-genuine assertion identified is the legacy-header-tamper check in `test-phase1b.js` (step 5) — see §4 D7.

---

## 3. Endpoint compliance (provider · port 3000)

| Method | Path | Documented | Actual | Notes |
|--------|------|-----------|--------|-------|
| GET | `/api/health` | free, JSON | **MATCH (with drift)** | Returns `{ok, service:"lumen-provider", rev, wallet_mode, agora_pubkey, andromeda_pubkey, persistence, endpoints[]}`. **`service` is still `"lumen-provider"`** (not `"agora-provider"`). BUILD-SUMMARY §"Branding history" says service identifiers in `/api/health` should be renamed (`andromeda-registry` etc.), but the provider was missed. |
| GET | `/api/v1/discovery` | free, JSON, schema `agora.directory.v1` | **PARTIAL** | Catalogue served correctly. **Schema string is `"lumen.directory.v1"`**, not `agora.directory.v1`. Provider's discovery JSON was not updated during the rebrand. (market-monitor + dataset-seller correctly emit `agora.directory.v1`.) |
| GET | `/api/v1/stats` | basic-auth | **PARTIAL** | Anon returns 401 with `WWW-Authenticate: Basic realm="lumen-admin"`. With basic auth, returns `{"error":"unauthorized","message":"admin disabled (set LUMEN_ADMIN_USER / LUMEN_ADMIN_PASS)"}` on a clean clone. Endpoint exists but is closed by default. |
| GET | `/api/v1/receipts/{id}` | none, free | **MATCH** | Unknown id → 404 `{error:"not_found", message:"no such receipt", request_id, docs}`. |
| POST | `/api/v1/listing-verify` | L402, 240 sat | **MATCH** | No auth → 402 + `WWW-Authenticate: L402 macaroon=…, invoice=…`, body has macaroon/invoice/payment_hash/amount_sats/expires_at + envelope. Bad auth → 401 `invalid or expired macaroon`. **Response headers are still `X-Lumen-Amount-Sats` / `X-Lumen-Resource`** — these were not renamed to `X-Agora-*`. |
| POST | `/api/v1/order-receipt` | L402, 120 sat | **MATCH** | 402 challenge served with same response-header drift as above. |
| POST | `/api/dev/pay` | mock-only | **MATCH** | 404 `not_found / no such invoice` for unknown payment_hash. |
| POST | `/api/v1/subscribe` | trust-deposit | **MATCH** | Missing-fields → 400 `bad_request, "subscriber_pubkey, service_local_id, deposit_sats required"` envelope. |
| GET | `/api/v1/subscriptions/:id` | none | **PARTIAL** | Works. Unknown id → 404 `{"error":"no such subscription"}` only — missing `request_id` / `docs` / `message`. Inconsistent with sibling routes' envelope. |
| **POST** | **`/api/v1/subscriptions/:id/topup`** | none, mock-paid | **BROKEN** — Next.js HTML 404 (`content-type: text/html`) | Confirmed still broken. P0. |
| **POST** | **`/api/v1/subscriptions/:id/cancel`** | none, refund | **BROKEN** — same | P0. |
| **GET** | **`/api/v1/subscriptions/:id/alerts?since=`** | none | **BROKEN** — same | P0. |
| POST | `/api/dev/fire-alert` | mock-only | **MATCH** | 400 `bad_request, "subscription_id and kind required"` envelope. |

### Provider error-envelope shape (still inconsistent)

Two shapes coexist:

- **Pino-traced routes:** `{ "error":"<code>", "message":"...", "request_id":"req_...", "docs":"https://github.com/ouazmourad/lumen#errors" }`.
- **A few hand-rolled responses** (e.g. `GET /api/v1/subscriptions/:id` for unknown id): `{"error":"no such subscription"}` only. Drift bug. P2.

Plus the macaroon `docs` URL still points to `https://github.com/ouazmourad/lumen#errors` — a personal fork, not the canonical project URL. Cosmetic.

---

## 4. Endpoint compliance (registry · port 3030)

19 endpoints documented; 18 OK; 1 architectural bug.

### NEW BUG — P0: legacy header families NOT accepted

`registry/src/lib/sig.ts:16` short-circuits with `"missing signature headers"` if the **canonical** `x-agora-pubkey` / `x-agora-sig` / `x-agora-timestamp` headers are not present. Only **after** that gate does it delegate to the shared `verifyRequest()` (which DOES iterate AGORA → ANDROMEDA → LUMEN families). Result: a request signed with `X-Andromeda-*` or `X-Lumen-*` headers is rejected at the gate before the family-tolerant verifier ever runs.

Reproduction (registry running on :3030):

```
$ curl -i -X POST -H 'X-Andromeda-Pubkey: e72…' -H 'X-Andromeda-Timestamp: 1777174000000' \
       -H 'X-Andromeda-Sig: deadbeef' -d '{"name":"x","url":"http://x"}' \
       http://localhost:3030/api/v1/sellers/register
HTTP/1.1 401 Unauthorized
{"error":"missing signature headers"}
```

vs. with X-Agora-* (accepted at the gate, fails at the next check):

```
$ curl -i -X POST -H 'X-Agora-Pubkey: e72…' -H 'X-Agora-Timestamp: 1777174000000' \
       -H 'X-Agora-Sig: deadbeef' -d '{"name":"x","url":"http://x"}' \
       http://localhost:3030/api/v1/sellers/register
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

This contradicts:

- BUILD-SUMMARY.md §"Endpoints (Registry)": *"Every Ed25519-signed endpoint accepts X-Agora-* (canonical), X-Andromeda-*, AND X-Lumen-* header families on incoming requests."*
- BUILD-SUMMARY.md §"Branding history" rebrand-compat row: *"HTTP signed-call headers | Verifier accepts EITHER family on incoming requests"*.
- ADR 0013's backward-compat promise.

The shared `@agora/core` `verifyRequest()` correctly handles the three families (verified by `test-phase0.js` `signed-request smoke test`), but the registry never reaches it.

`scripts/test-phase1b.js` line 129 ostensibly verifies this works:

```
ok · registry still accepts (and rejects on bad sig) legacy X-Andromeda-* family (401)
```

— but the assertion only checks that the response code is 401; it never checks WHY. Both "missing signature headers" (the bug) and "signature invalid" (the documented behavior) yield 401. The test passes by coincidence.

### Other registry endpoints

| Endpoint | Probe result |
|----------|--------------|
| `GET /api/v1/health` | 200, `{ok, service:"agora-registry", rev, db:"ok", endpoints[]}`. Service id is correctly `"agora-registry"`. |
| `GET /api/v1/sellers` | 200 + array. |
| `GET /api/v1/sellers/<bogus>` | 404 `{"error":"no such seller"}`. |
| `GET /api/v1/sellers/<pubkey>/stats` | 200 + JSON. |
| `GET /api/v1/services` | 200. |
| `GET /api/v1/services/search?q=verification` | 200 + filtered list. |
| `POST /api/v1/orchestrator/recommend` | 200 + ranked list with `weights:{0.6,0.2,0.2}`. |
| `POST /api/v1/orchestrator/recommend` (no intent) | 400 `intent (string ≥2 chars) required`. |
| `GET /api/v1/reviews/assigned` (no `reviewer_pubkey`) | 400 `reviewer_pubkey query required`. |
| `POST /api/v1/admin/decay` (no `x-admin-secret`) | 401 `unauthorized`. |
| `POST /api/v1/admin/fast-forward` (no auth) | 401 `unauthorized`. |
| `GET /api/v1/platform/revenue` (no auth) | 401 `unauthorized`. |

### Registry vs. provider error envelope drift

Registry uses `{"error":"<message>"}`. Provider uses `{error, message, request_id, docs}`. Same repo, two contracts. Carried over from previous audit. P2.

---

## 5. Endpoint compliance (market-monitor · 3100, dataset-seller · 3200)

Both agents are plain Node `http` servers. All documented endpoints respond. `/api/health` reports `service:"agora-market-monitor"` / `service:"agora-dataset-seller"` correctly (provider was missed; see §3). Discovery schemas are correctly `agora.directory.v1`. Mock-mode pricing matches docs (50 sat/event for github-advisory; 5000 sat for noaa-pnw-2015-2025).

---

## 6. MCP tool compliance

**Counts:** `mcp/server.js` registers **24 canonical `agora_*`** tools. Each has an `andromeda_*` alias (24 of them). Seven of them additionally have `lumen_*` aliases.

- 24 + 24 + 7 = **55 registered names**.
- 24 unique handlers (each `agora_*` registered handler is reused by aliases).

BUILD-SUMMARY §"MCP tools" claims:

> 23 canonical `agora_*` tools + 14 deprecated aliases (`andromeda_*` for all 23, `lumen_*` for the original 7) = **37 registered names** routing to **23 unique handlers**.

Three numbers are wrong:

- **23** canonical → **24** (the doc's own table below the prose actually lists 24).
- **14** deprecated aliases → **31** (24 `andromeda_*` + 7 `lumen_*`).
- **37** total → **55**.
- **23** unique handlers → **24**.

The off-by-one canonical count was already noted in the previous audit. The other three are new post-rebrand: the doc still says "14 deprecated aliases" as if there were only 7 lumen + 7 andromeda (which would be the case if every canonical only had a one-step-back alias), but the rebrand-1 era added `andromeda_*` to all 17 phase-1+ tools, so the ratio is now 1.29 aliases per canonical, not 0.6.

### Per-tool table (canonical name; cost doc → cost code; dual-alias check)

All 7 phase 0/1 tools register with both aliases; all 17 phase 1+ tools register with the andromeda alias only. The `description` of every alias begins with `[deprecated alias of <canonical> — will be removed in a future release]`. Schema (Zod) for each canonical and alias matches the documented input verbatim (verified for `set_budget(int)`, `verify_listing({place,date})`, `subscribe(seller_pubkey, service_local_id, deposit_sats, ...)`, `purchase_dataset(seller_pubkey, dataset_id, ?save_path)`).

| Canonical | Andromeda alias | Lumen alias | Cost (doc) | Cost (code) | OK? |
|-----------|:---:|:---:|------------|-------------|:---:|
| `agora_status` | yes | yes | free | free | ok |
| `agora_discover` | yes | yes | free | free | ok |
| `agora_balance` | yes | yes | free | free | ok |
| `agora_set_budget` | yes | yes | free | free | ok |
| `agora_verify_listing` | yes | yes | ~240 sat | challenge served at 240 (provider-set) | ok |
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
| `agora_purchase_dataset` | yes | — | 5000 sat (NOAA) | 5000 sat **but real-mode early-returns "not implemented" (`mcp/server.js:685`)** | **partial** |
| `agora_list_datasets` | yes | — | free | free | ok |

### Dual-alias verification — PASS

For every `agora_*` canonical, the corresponding `andromeda_*` is registered via the same `registerWithAliases()` helper, which calls `server.registerTool(alias, {...def, description: "[deprecated alias of <canonical>] ..."}, handler)` — identical handler reference.

For each of the 7 originals, the corresponding `lumen_*` is also registered the same way.

`test-phase1b.js` and `test-mcp.js` exercise both alias families end-to-end via `mcp.client.callTool(...)`. `test-mcp.js` deliberately uses `lumen_set_budget` and `lumen_verify_listing` to prove they reach the same handler.

---

## 7. Mock-mode verification

`MOCK_MODE=true` is the default in `provider/.env.local` and `buyer/.env`. Ran `npm run demo:multi`:

```
listing-verify  240 sat  364 ms
order-receipt   120 sat  105 ms
total spent     360 sat
total fees        0 sat
round trip      888 ms
done — two services, one wallet, no human.
```

All traffic was localhost. No NWC outbound. Source review (unchanged from previous audit):

- `provider/src/lib/wallet.ts` — `nwcClient()` is the only `NWCClient` constructor, gated behind `wallet()` selector that early-returns the mock branch when `MOCK_MODE=true`.
- `buyer/lumen.js` — `ln()` returns nothing in mock, `pay()` hits `/api/dev/pay`.
- `mcp/lumen-client.js` — same pattern.

Top-level `import { LNClient } from "@getalby/sdk"` does not open a connection; classes are constructed only inside `MOCK`-guarded helpers.

**Mock-mode integrity: PASS.**

---

## 8. Status of previous audit's bugs

| Previous bug | Status | Evidence |
|--------------|--------|----------|
| 3 provider subscription sub-routes return Next.js HTML 404 (`/topup`, `/cancel`, `/alerts`) | **STILL PRESENT** | curl probes return `404 / content-type: text/html / charset=utf-8 / X-Powered-By: Next.js` for all three on port 3000. |
| `andromeda_purchase_dataset` (now `agora_purchase_dataset`) silently returns "real-mode dataset payment not implemented" | **STILL PRESENT** | `mcp/server.js:685` has the exact same early-return. Renamed to canonical name. Not listed in BUILD-SUMMARY's "Known limitations". |
| Legacy `test-phase1.js` fails 1/16 on clean clone (admin creds env vars unset) | **STILL PRESENT** | Re-ran on this clone; `FAIL · 1 of 16 checks failed` at step 7 (admin /stats 401). Error message is now `admin disabled (set LUMEN_ADMIN_USER / LUMEN_ADMIN_PASS)` — the env-var names referenced in the error are still LUMEN_-prefixed. |

None of the three were fixed.

---

## 9. New bugs found, severity-ranked

### P0 · Registry rejects `X-Andromeda-*` and `X-Lumen-*` signed headers despite ADR 0013 backwards-compat promise

See §4 above. `registry/src/lib/sig.ts:16` checks ONLY for `x-agora-pubkey` / `x-agora-sig` / `x-agora-timestamp`; if any is missing it returns `missing signature headers` without invoking the family-tolerant `verifyRequest()`. Affected: 7 signed-write registry routes.

This was almost certainly NOT exercised end-to-end: `test-phase1b.js` `step 5` claims to test it, but only checks that the response is 401, not the reason. Real seller agents written against the rebrand-1-era contract (using `X-Andromeda-*`) cannot self-register, record transactions, rate sellers, or participate in peer review against this registry.

### P1 · `agora_purchase_dataset` real-mode unimplemented (carried over)

`mcp/server.js:685`: `return fail(\`real-mode dataset payment not implemented in MCP yet (NWC route)\`);`

Doc table promises 5000 sat real-mode payment; only mock works. Not listed in BUILD-SUMMARY's "Known limitations" §1–8. Same as previous audit.

### P1 · Legacy `test-phase1.js` still fails 1/16 (carried over)

Same root cause as previous audit — admin creds env vars unset in `provider/.env.local` on a clean clone. The error message even names the missing vars (`LUMEN_ADMIN_USER / LUMEN_ADMIN_PASS`); the test does not set them. BUILD-SUMMARY calls this test "(legacy single-provider, intact)" — "intact" remains misleading.

### P1 · Provider was not fully rebranded (`/api/health` service id, discovery schema, response headers)

Despite ADR 0013 / BUILD-SUMMARY explicitly listing these in the rebrand checklist, the provider still emits:

- `/api/health` → `"service":"lumen-provider"` (should be `"agora-provider"`)
- `/api/v1/discovery` → `"schema":"lumen.directory.v1"` (should be `agora.directory.v1`; market-monitor + dataset-seller did get updated)
- 402 challenges → `X-Lumen-Amount-Sats` / `X-Lumen-Resource` headers (the docs imply only `X-Agora-*` should leave the system on outgoing responses)

These are P1 (not P0) because clients that key off the discovery schema today (e.g. 402index.io directories) would silently miscategorize this provider as a "LUMEN-era" agent. `BUILD-SUMMARY.md` line 23 says the parser accepts both `andromeda.directory.v1` and `agora.directory.v1` — but not `lumen.directory.v1`.

### P2 · BUILD-SUMMARY MCP tool counts wrong by 4 numbers

"23 canonical + 14 deprecated = 37 routing to 23 handlers" → actual: **24 canonical + 31 deprecated = 55 routing to 24 handlers**. The doc table itself lists 24 canonical entries.

### P2 · `test-phase7.js` is order-dependent and fails on a fresh registry

The script's docstring says it "spawns the web app... against the live registry" but it doesn't seed the registry first. If run on a clean registry (e.g. immediately after `npm run registry`), it fails 9/14 because there's no `vision-oracle-3` seller and no `listing-verify` service. It only passes if a previous test (`test-phase1b`, or a manual `npm run provider`) has already self-registered the provider. The previous BUILD-SUMMARY entry "test-phase7 PASS · 14/14 — public web index" doesn't capture this fragility.

### P2 · `test-phase1b.js` step 5 false positive (legacy header acceptance)

The script verifies a tampered legacy `X-Andromeda-*` request returns 401 but does not check the response body's `error` field. The bug in §4 (rejection happens at the wrong layer with the wrong reason) would be caught if the test asserted `error === "signature invalid"` instead of just `status === 401`.

### P2 · Provider error envelope still inconsistent (carried over)

Some routes return the standardized envelope (`{error, message, request_id, docs}`); a few return only `{"error":"..."}`. Same as previous audit.

### P2 · Registry vs provider error envelope drift (carried over)

Registry: `{"error":"<message>"}`. Provider: `{error, message, request_id, docs}`. Same as previous audit.

### P2 · Macaroon `docs` URL points to personal fork (carried over)

`https://github.com/ouazmourad/lumen#errors` — cosmetic. Carried over.

---

## 10. Discrepancies between docs and code

D1. **README.md "Endpoints" table** still lists only 5 provider endpoints — no mention of `/api/v1/stats`, `/api/v1/receipts/{id}`, `/api/v1/subscribe`, `/api/v1/subscriptions/*`, or `/api/dev/fire-alert`. README is a stale subset. Carried over.

D2. **PAYMYAGENT.md** describes only the 7 original tools; says "Twelve checks; should print PASS · 12/12" matching `test-mcp.js`. BUILD-SUMMARY claims 24 canonical tools across 7 phases. PAYMYAGENT.md was not updated when phases 1–7 added 17 more tools. Carried over (now slightly worse: 17 vs 18).

D3. **PAYMYAGENT.md** §"5-minute install" code block uses `MAX_BUDGET_SATS=5000` and `MAX_PRICE_SATS=4000` which match `mcp/budget.js` defaults — this is consistent.

D4. **BUILD-SUMMARY.md** "23 canonical = 30 / 37 / 23 unique" — wrong on all three numbers, see P2 above.

D5. **BUILD-SUMMARY.md** lists `test-phase1.js` as "(legacy single-provider, intact)". Not intact — fails 1/16 on clean clone.

D6. **BUILD-SUMMARY.md** §"How to run end-to-end" lists `test-phase7` as expecting registry to be running, but doesn't say the registry must already have a seller registered. On a fresh registry, phase 7 fails 9/14.

D7. **BUILD-SUMMARY.md** §"Endpoints (Registry)" → *"Every Ed25519-signed endpoint accepts X-Agora-*, X-Andromeda-*, AND X-Lumen-* header families on incoming requests."* — the registry actually accepts ONLY `X-Agora-*`. P0 above.

D8. **BUILD-SUMMARY.md** §"Branding history" → *"Service identifiers in `/api/health` | `andromeda-registry` etc. → `agora-registry` etc. | Just renamed"* — the provider's `/api/health` `service` field is still `"lumen-provider"`. Missed.

D9. **BUILD-SUMMARY.md** §"Branding history" → *"Discovery schema → `agora.directory.v1` | Parser accepts both"* — provider emits `lumen.directory.v1`, which is in NEITHER list.

D10. **BUILD-SUMMARY.md** §"Known limitations" still has 8 items; `agora_purchase_dataset` real-mode unimplemented should be #9.

D11. **BUILD-SUMMARY.md** §"Endpoints (Provider)" lists `POST /api/v1/subscriptions/:id/topup`, `cancel`, `alerts` as if working. They return Next.js HTML 404. P0 above.

D12. **README.md / PAYMYAGENT.md** instruct users to set `LUMEN_PROVIDER_URL` etc. but the legacy admin-creds env vars (`LUMEN_ADMIN_USER` / `LUMEN_ADMIN_PASS`) are not documented anywhere — `provider/.env.local` ships without them. Setting them is the only way past `/api/v1/stats`. P2 doc gap.

---

End of audit.
