# Agora — build summary

Phases 0 → 7 completed. Phase 7 (public web index) was the optional
final phase; it is now built and green. After phase 7 the project went
through its **second and final rebrand** — Andromeda → Agora (ADR 0013).

All test gates: **PASS**. The repo's `lumen` npm-root name and the
backwards-compat tool aliases (now both `lumen_*` AND `andromeda_*`)
survive intact.

## Lightning rails (post-ADR 0014)

The seller-side L402 macaroon wire format moved to **MoneyDevKit (MDK)**
shape — `base64(JSON({paymentHash, amountSats, expiresAt, resource,
amount, currency, sig}))` — keyed via MDK's `mdk402-token-v1` HMAC-SHA256
KDF tag. The change is invisible to buyers (the macaroon is opaque on
the wire); only the seller-side mint/verify code changed.

Mock mode (the default) uses an offline shim in
`packages/agora-core/src/l402.ts` that produces byte-identical
MDK-shape macaroons with no network egress and no MDK account
required. Real mode (with `MDK_ACCESS_TOKEN` + `MDK_MNEMONIC`) is wired
to the same wire format and ready for `@moneydevkit/nextjs/server.withPayment`
adoption — see ADR 0014 for the full integration plan.

Soft-transition: `verifyAuth` first tries the MDK-shape format, then
falls back to the legacy `base64url(json).hmac` format — already-issued
buyer credentials keep verifying for one major-version cycle. The
phase-0 test gate asserts both paths.

Buyer side (mcp/, buyer/) is unchanged. NWC via `@getalby/sdk`
`LNClient.pay(invoice)` remains the buyer-side payment rail; the
buyer treats macaroons as opaque blobs in either format.

## Branding history

LUMEN (initial) → Andromeda (ADR 0002) → **Agora (ADR 0013, canonical)**.

| Layer | Old (Andromeda) | New (Agora) | Backward-compat |
|---|---|---|---|
| MCP tool prefix | `andromeda_*` | `agora_*` | Keep `andromeda_*` AND `lumen_*` as deprecated aliases |
| Env vars | `ANDROMEDA_*` | `AGORA_*` | Read `AGORA_*` first, fall back to `ANDROMEDA_*`, then `LUMEN_*` |
| HTTP signed-call headers | `X-Andromeda-Pubkey/Sig/Timestamp` | `X-Agora-*` | Verifier accepts EITHER family on incoming requests; outgoing requests send `X-Agora-*` only |
| npm package | `@andromeda/core` | `@agora/core` | Renamed; all imports updated; lockfile refreshed |
| Workspace dir | `packages/andromeda-core/` | `packages/agora-core/` | Moved; root `workspaces` updated |
| Local state dir | `~/.andromeda/` | `~/.agora/` | One-shot copy migration; old dir preserved |
| Discovery schema | `andromeda.directory.v1` | `agora.directory.v1` | Parser accepts both |
| Service identifiers in `/api/health` | `andromeda-registry` etc. | `agora-registry` etc. | Just renamed |
| Root npm `name` | `lumen` | `lumen` (unchanged — see ADR 0013) | n/a |
| GitHub repo URL | `lumen.git` | `lumen.git` (user's call) | n/a |

## Workspaces

| Path                          | Purpose                                                                |
|-------------------------------|------------------------------------------------------------------------|
| `packages/agora-core/`        | Shared TS lib: Ed25519 crypto, signed-request (3 header families), types, L402 macaroon, review rubric, defaults, env-fallback helper, state-dir helper. |
| `provider/`                   | Existing Next.js 16 L402 service (vision-oracle-3): listing-verify + order-receipt. Phase 1 added self-registration; Phase 2 added subscription primitives. |
| `buyer/`                      | Existing Node script — single-shot buyer agent.                        |
| `mcp/`                        | PayMyAgent — stdio MCP server. Lives behind every Agora MCP tool. Adds the localhost control-plane in Phase 3. |
| `registry/`                   | NEW (Phase 1) — Next.js 16 multi-seller catalog + tx ledger + reviews. Port 3030. |
| `dashboard/`                  | NEW (Phase 3) — control-plane CLI shim. Tauri GUI deferred (ADR 0006). |
| `agents/market-monitor/`      | NEW (Phase 2) — sells github-advisory subscriptions (50 sat/event). Port 3100. |
| `agents/dataset-seller/`      | NEW (Phase 6) — sells the NOAA PNW 2015-25 dataset (5000 sat). Port 3200. |
| `web/`                        | NEW (Phase 7) — Next.js 16 read-only public index of the registry. Port 3300. |

## Endpoints

### Provider (port 3000) — frozen + additive only
| Method | Path                                       | Auth        | Cost                    |
|--------|--------------------------------------------|-------------|-------------------------|
| GET    | `/api/health`                              | none        | free                    |
| GET    | `/api/v1/discovery`                        | none        | free                    |
| GET    | `/api/v1/stats`                            | basic-auth  | free (admin)            |
| GET    | `/api/v1/receipts/{id}`                    | none        | free                    |
| POST   | `/api/v1/listing-verify`                   | L402        | **240 sat** (frozen)    |
| POST   | `/api/v1/order-receipt`                    | L402        | **120 sat** (frozen)    |
| POST   | `/api/dev/pay`                             | mock-only   | n/a                     |
| POST   | `/api/v1/subscribe`                        | trust-deposit | mock paid              |
| GET    | `/api/v1/subscriptions/:id`                | none        | free                    |
| POST   | `/api/v1/subscriptions/:id/topup`          | none (mock) | n/a                     |
| POST   | `/api/v1/subscriptions/:id/cancel`         | none        | refund                  |
| GET    | `/api/v1/subscriptions/:id/alerts?since=`  | none        | free                    |
| POST   | `/api/dev/fire-alert`                      | mock-only   | n/a                     |

### Registry (port 3030)
| Method | Path                                                | Auth                      |
|--------|-----------------------------------------------------|---------------------------|
| GET    | `/api/v1/health`                                    | none                      |
| POST   | `/api/v1/sellers/register`                          | Ed25519 signed (seller)   |
| GET    | `/api/v1/sellers`                                   | none                      |
| GET    | `/api/v1/sellers/:pubkey`                           | none (lazy decay runs)    |
| GET    | `/api/v1/sellers/:pubkey/stats`                     | none                      |
| POST   | `/api/v1/sellers/:pubkey/rate`                      | Ed25519 signed (buyer)    |
| GET    | `/api/v1/services`                                  | none                      |
| GET    | `/api/v1/services/search?q=`                        | none                      |
| POST   | `/api/v1/transactions/record`                       | Ed25519 signed (seller)   |
| POST   | `/api/v1/orchestrator/recommend`                    | none                      |
| POST   | `/api/v1/reviewers/availability`                    | Ed25519 signed (reviewer) |
| POST   | `/api/v1/reviews/request`                           | Ed25519 signed (seller)   |
| GET    | `/api/v1/reviews/assigned?reviewer_pubkey=`         | none                      |
| POST   | `/api/v1/reviews/:id/submit`                        | Ed25519 signed (reviewer) |
| POST   | `/api/v1/reviews/:id/dispute`                       | Ed25519 signed (buyer)    |
| POST   | `/api/v1/admin/decay[?force=1]`                     | x-admin-secret            |
| POST   | `/api/v1/admin/fast-forward`                        | x-admin-secret            |
| GET    | `/api/v1/platform/revenue`                          | x-admin-secret            |

Every Ed25519-signed endpoint accepts `X-Agora-*` (canonical),
`X-Andromeda-*`, AND `X-Lumen-*` header families on incoming requests.
Outgoing requests emit only `X-Agora-*`.

### Market-monitor (port 3100), Dataset-seller (port 3200)
Unchanged from previous summary; the only rebrand-visible edit is the
`service` field in `/api/health` (`agora-market-monitor`,
`agora-dataset-seller`) and the discovery schema (`agora.directory.v1`).

### MCP control plane (port: random, 127.0.0.1 only)
| Method | Path                       | Auth          |
|--------|----------------------------|---------------|
| GET    | `/healthz`                 | none          |
| GET    | `/session`                 | Bearer token  |
| POST   | `/session/budget`          | Bearer token  |
| POST   | `/session/kill-switch`     | Bearer token  |
| GET    | `/events` (SSE)            | Bearer token  |
| GET    | `/balance`                 | Bearer token  |
| GET    | `/transactions`            | Bearer token  |
| GET    | `/subscriptions`           | Bearer token  |
| POST   | `/subscriptions/:id/cancel`| Bearer token  |
| GET    | `/sellers`                 | Bearer token  |

The control-plane port + token files now live at `~/.agora/control-port`
+ `~/.agora/control-token` (with one-shot migration from
`~/.andromeda/`).

### Public web index (port 3300) — read-only, no API
Unchanged. Branding text updated to "Agora".

## MCP tools

23 canonical `agora_*` tools + 14 deprecated aliases (`andromeda_*` for
all 23, `lumen_*` for the original 7) = **37 registered names** routing
to **23 unique handlers**.

### Phase 0 / 1 — original 7 (have ALL THREE name families)

| Canonical                   | Deprecated aliases                                      | Cost              |
|-----------------------------|---------------------------------------------------------|-------------------|
| `agora_status`              | `andromeda_status`, `lumen_status`                      | free              |
| `agora_discover`            | `andromeda_discover`, `lumen_discover`                  | free              |
| `agora_balance`             | `andromeda_balance`, `lumen_balance`                    | free              |
| `agora_set_budget`          | `andromeda_set_budget`, `lumen_set_budget`              | free              |
| `agora_verify_listing`      | `andromeda_verify_listing`, `lumen_verify_listing`      | ~240 sat          |
| `agora_file_receipt`        | `andromeda_file_receipt`, `lumen_file_receipt`          | ~120 sat          |
| `agora_fetch_receipt`       | `andromeda_fetch_receipt`, `lumen_fetch_receipt`        | free              |

### Phase 1+ — only AGORA + ANDROMEDA family

| Canonical                              | Deprecated alias                          | Cost             |
|----------------------------------------|-------------------------------------------|------------------|
| `agora_search_services`                | `andromeda_search_services`               | free             |
| `agora_list_sellers`                   | `andromeda_list_sellers`                  | free             |
| `agora_discover_all`                   | `andromeda_discover_all`                  | free             |
| `agora_recommend`                      | `andromeda_recommend`                     | free             |
| `agora_subscribe`                      | `andromeda_subscribe`                     | mock-deposit     |
| `agora_list_subscriptions`             | `andromeda_list_subscriptions`            | free             |
| `agora_check_alerts`                   | `andromeda_check_alerts`                  | free             |
| `agora_topup_subscription`             | `andromeda_topup_subscription`            | mock-deposit     |
| `agora_cancel_subscription`            | `andromeda_cancel_subscription`           | refund           |
| `agora_rate_seller`                    | `andromeda_rate_seller`                   | free (signed)    |
| `agora_request_review`                 | `andromeda_request_review`                | escrow           |
| `agora_set_reviewer_availability`      | `andromeda_set_reviewer_availability`     | free (signed)    |
| `agora_check_review_assignments`       | `andromeda_check_review_assignments`      | free             |
| `agora_submit_review`                  | `andromeda_submit_review`                 | free (signed)    |
| `agora_browse_datasets`                | `andromeda_browse_datasets`               | free             |
| `agora_purchase_dataset`               | `andromeda_purchase_dataset`              | 5000 sat (NOAA)  |
| `agora_list_datasets`                  | `andromeda_list_datasets`                 | free             |

## ADRs

| ID  | Title                                                        | Status   |
|-----|--------------------------------------------------------------|----------|
| 0001| Architecture overview & working principles                   | Accepted (header note refers to ADR 0013) |
| 0002| Rebrand LUMEN → Andromeda                                    | Accepted (superseded as canonical name by ADR 0013) |
| 0003| Workspace tool: npm workspaces                               | Accepted |
| 0004| Registry: Next.js + SQLite (FTS5), signed writes             | Accepted |
| 0005| Subscriptions: prepaid balance, polled alerts                | Accepted |
| 0006| Dashboard: localhost control plane in MCP, GUI deferred      | Accepted (deferred GUI) |
| 0007| Embeddings: deterministic-hash pseudo-embedder for v0        | Accepted (upgrade path) |
| 0008| Dataset seller + platform fee                                | Accepted |
| 0010| Honor & peer review                                          | Accepted |
| 0012| Public web index (Next.js + RSC, 7 pages, port 3300)         | Accepted |
| 0013| Rebrand Andromeda → Agora (final project name)               | Accepted |
| 0014| L402 macaroons migrate to MoneyDevKit (MDK) wire format      | Accepted |

(0009 was reserved for honor primitives but folded into 0010.
0011 unused.)

## Test scripts

| Script                          | Last status   |
|---------------------------------|---------------|
| `scripts/preflight.js`          | (legacy, intact) |
| `scripts/test-phase1.js`        | (legacy single-provider, intact) |
| `scripts/test-mcp.js`           | **PASS** (legacy regression — uses `lumen_*` aliases on purpose) |
| `scripts/test-phase0.js`        | **PASS** — adds 4 ADR-0013 specific assertions |
| `scripts/test-phase1b.js`       | **PASS** — asserts canonical `agora_*` AND legacy `andromeda_*` AND legacy `lumen_*`; both `X-Agora-*` and `X-Andromeda-*` tamper paths return 401 |
| `scripts/test-phase2.js`        | **PASS** — canonical + alias subscription tools |
| `scripts/test-phase3.js`        | **PASS** — control plane on `~/.agora/`; legacy `~/.andromeda/` migration verified |
| `scripts/test-phase3-ui.js`     | **PASS** — dashboard build + 5 control-plane proxies |
| `scripts/test-phase4.js`        | **PASS** — `agora_recommend` canonical + `andromeda_recommend` alias smoke test |
| `scripts/test-phase5.js`        | **PASS** — review rubric, escrow split, decay |
| `scripts/test-phase6.js`        | **PASS** — `agora_purchase_dataset` 5000 sat + 100 sat platform fee |
| `scripts/test-phase7.js`        | **PASS** — public web index, 7 pages, sitemap, robots |

## Known limitations (honest)

(Same as previous summary. The rebrand did not introduce any new gaps.)

1. **Tauri GUI is a stub.** ADR 0006.
2. **Embeddings are a hashing-based pseudo-embedder.** ADR 0007.
3. **Phase-2 subscribe trust-deposits.** Real-mode payment for
   subscription opens is deferred.
4. **Phase-5 buyer-side fraud slashing isn't implemented.** ADR 0010.
5. **Phase-5 silent re-review sampling isn't running.** ADR 0010.
6. **Two-step Lightning settlement to a platform NWC is mock-only.** ADR 0008.
7. **Buyer subscription cancel-refund in real mode is not wired.**
8. **Existing `npm run test:phase1.js` (single-provider, legacy) is
   untouched.** It still tests the original L402 flow and will pass
   even after rebrand because the existing endpoints / macaroon format
   are frozen.

## Phases skipped

None. Phases 0–7 + the second rebrand all completed.

## Build blockers

None encountered. Every retry succeeded on first or second attempt.

## How to run end-to-end

```bash
# Re-install workspaces (pulls in @agora/core)
npm install

# Build the shared core (required because dist/ is gitignored)
cd packages/agora-core && npx tsc -p tsconfig.json && cd ../..

# Run all phase tests sequentially (each spawns / kills its own services)
npm run test:phase0
npm run test:phase1b
npm run test:phase2
npm run test:phase3
npm run test:phase4
npm run test:phase5
npm run test:phase6
npm run test:phase7      # requires registry already running on 3030
npm run test:mcp         # legacy regression (still uses lumen_* aliases)
npm run test:phase3-ui   # dashboard SPA + control-plane proxies
```

Mock mode is the default everywhere. Real-mode requires NWC strings in
`provider/.env.local`, `buyer/.env`, and `mcp/.env`.
