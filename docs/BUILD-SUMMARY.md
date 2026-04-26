# Andromeda — build summary

Phases 0 → 7 completed. Phase 7 (public web index) was the optional
final phase; it is now built and green.

All test gates: **PASS**. The repo's `lumen` npm name and the
backwards-compat `lumen_*` MCP tool aliases survive intact (ADR 0002).

## Workspaces

| Path                          | Purpose                                                                |
|-------------------------------|------------------------------------------------------------------------|
| `packages/andromeda-core/`    | Shared TS lib: Ed25519 crypto, signed-request, types, L402 macaroon, review rubric, defaults. |
| `provider/`                   | Existing Next.js 16 L402 service (vision-oracle-3): listing-verify + order-receipt. Phase 1 added self-registration; Phase 2 added subscription primitives. |
| `buyer/`                      | Existing Node script — single-shot buyer agent.                        |
| `mcp/`                        | PayMyAgent — stdio MCP server. Lives behind every Andromeda MCP tool. Adds the localhost control-plane in Phase 3. |
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

### Market-monitor (port 3100)
| Method | Path                                                | Cost                      |
|--------|-----------------------------------------------------|---------------------------|
| GET    | `/api/health`                                       | free                      |
| GET    | `/api/v1/discovery`                                 | free                      |
| POST   | `/api/v1/subscribe`                                 | trust-deposit (mock)      |
| GET    | `/api/v1/subscriptions/:id`                         | free                      |
| POST   | `/api/v1/subscriptions/:id/topup`                   | mock-paid                 |
| POST   | `/api/v1/subscriptions/:id/cancel`                  | free (refund)             |
| GET    | `/api/v1/subscriptions/:id/alerts?since=`           | free                      |
| POST   | `/api/dev/fire-alert`                               | mock-only                 |
| POST   | `/api/dev/tick`                                     | mock-only                 |

### Dataset-seller (port 3200)
| Method | Path                                                | Cost                      |
|--------|-----------------------------------------------------|---------------------------|
| GET    | `/api/health`                                       | free                      |
| GET    | `/api/v1/discovery`                                 | free                      |
| GET    | `/api/v1/dataset/:id/preview`                       | free                      |
| POST   | `/api/v1/dataset/:id/purchase`                      | **L402, 5000 sat**        |
| GET    | `/api/v1/dataset/:id/download?signed_url=`          | signed-URL only (24h)     |
| POST   | `/api/dev/pay`                                      | mock-only                 |

### MCP control plane (port: random, 127.0.0.1 only)
| Method | Path                       | Auth          |
|--------|----------------------------|---------------|
| GET    | `/healthz`                 | none          |
| GET    | `/session`                 | Bearer token  |
| POST   | `/session/budget`          | Bearer token  |
| POST   | `/session/kill-switch`     | Bearer token  |
| GET    | `/events` (SSE)            | Bearer token  |

### Public web index (port 3300) — read-only, no API
| Method | Path                                | What it shows                                  |
|--------|-------------------------------------|------------------------------------------------|
| GET    | `/`                                 | Hero, headline stats, featured services, how-it-works |
| GET    | `/sellers`                          | Paginated seller list, sort + name filter      |
| GET    | `/sellers/:pubkey`                  | Seller detail: services, badges, activity      |
| GET    | `/services`                         | Service catalog with type/price/honor filters  |
| GET    | `/services/:id`                     | Service detail + similar (via /recommend)      |
| GET    | `/search?q=`                        | FTS5-backed search (delegates to registry)     |
| GET    | `/recommend?intent=`                | Orchestrator score breakdown                   |
| GET    | `/sitemap.xml`                      | Auto-enumerated from registry                  |
| GET    | `/robots.txt`                       | Permissive (someday-deployable)                |

## MCP tools

| Canonical name                          | Deprecated alias    | Cost             | What it does                                     |
|-----------------------------------------|---------------------|------------------|--------------------------------------------------|
| `andromeda_status`                      | `lumen_status`      | free             | Wallet mode, budget, registry & provider URL     |
| `andromeda_discover`                    | `lumen_discover`    | free             | Catalog of the connected single provider         |
| `andromeda_balance`                     | `lumen_balance`     | free             | Wallet balance via NWC                           |
| `andromeda_set_budget`                  | `lumen_set_budget`  | free             | Reset per-session sat cap                        |
| `andromeda_verify_listing`              | `lumen_verify_listing` | ~240 sat       | OSM-geocoded listing verification                |
| `andromeda_file_receipt`                | `lumen_file_receipt`   | ~120 sat       | Signed delivery receipt                          |
| `andromeda_fetch_receipt`               | `lumen_fetch_receipt`  | free           | Replay an existing receipt                       |
| `andromeda_search_services`             | —                   | free             | Cross-seller FTS5 search                         |
| `andromeda_list_sellers`                | —                   | free             | Paginated seller list                            |
| `andromeda_discover_all`                | —                   | free             | Cross-seller catalog                             |
| `andromeda_recommend`                   | —                   | free             | Orchestrator with explainable score breakdown    |
| `andromeda_subscribe`                   | —                   | mock-deposit     | Open prepaid subscription                        |
| `andromeda_list_subscriptions`          | —                   | free             | List subscriptions tracked by this MCP           |
| `andromeda_check_alerts`                | —                   | free             | Poll alerts since last watermark                 |
| `andromeda_topup_subscription`          | —                   | mock-deposit     | Add sats to a subscription                       |
| `andromeda_cancel_subscription`         | —                   | refund           | Cancel; refund unused balance                    |
| `andromeda_rate_seller`                 | —                   | free (signed)    | 1-5 star buyer rating; honor +/-                 |
| `andromeda_request_review`              | —                   | escrow           | Open peer review with escrow                     |
| `andromeda_set_reviewer_availability`   | —                   | free (signed)    | Mark this identity as a reviewer                 |
| `andromeda_check_review_assignments`    | —                   | free             | List pending review assignments                  |
| `andromeda_submit_review`               | —                   | free (signed)    | Submit rubric review (escrow split 95/5)         |
| `andromeda_browse_datasets`             | —                   | free             | List type=dataset services                       |
| `andromeda_purchase_dataset`            | —                   | 5000 sat (NOAA)  | L402-paywalled dataset purchase, signed URL DL   |
| `andromeda_list_datasets`               | —                   | free             | List `~/.andromeda/datasets/`                    |

7 deprecated `lumen_*` aliases + 23 canonical `andromeda_*` tools = **30 total** (24 unique handlers).

## ADRs

| ID  | Title                                                        | Status   |
|-----|--------------------------------------------------------------|----------|
| 0001| Architecture overview & working principles                   | Accepted |
| 0002| Rebrand LUMEN → Andromeda                                    | Accepted |
| 0003| Workspace tool: npm workspaces                               | Accepted |
| 0004| Registry: Next.js + SQLite (FTS5), signed writes             | Accepted |
| 0005| Subscriptions: prepaid balance, polled alerts                | Accepted |
| 0006| Dashboard: localhost control plane in MCP, GUI deferred      | Accepted (deferred GUI) |
| 0007| Embeddings: deterministic-hash pseudo-embedder for v0        | Accepted (upgrade path) |
| 0008| Dataset seller + platform fee                                | Accepted |
| 0010| Honor & peer review                                          | Accepted |
| 0012| Public web index (Next.js + RSC, 7 pages, port 3300)         | Accepted |

(0009 was reserved for honor primitives but folded into 0010.
0011 unused.)

## Test scripts

| Script                          | Last status   |
|---------------------------------|---------------|
| `scripts/preflight.js`          | (legacy, intact) |
| `scripts/test-phase1.js`        | (legacy single-provider, intact) |
| `scripts/test-mcp.js`           | **PASS · 12/12** (regression check, kept green throughout) |
| `scripts/test-phase0.js`        | **PASS · 12/12** |
| `scripts/test-phase1b.js`       | **PASS · 16/16** |
| `scripts/test-phase2.js`        | **PASS · 12/12** |
| `scripts/test-phase3.js`        | **PASS · 12/12** |
| `scripts/test-phase4.js`        | **PASS · 11/11** |
| `scripts/test-phase5.js`        | **PASS · 16/16** |
| `scripts/test-phase6.js`        | **PASS · 10/10** |
| `scripts/test-phase7.js`        | **PASS · 14/14** |

Total green checks across new gates: **115/115**.

## Known limitations (honest)

1. **Tauri GUI is a stub.** Phase 3 ships only the headless control plane.
   `dashboard/` runs a CLI placeholder; the Tauri 2.x React shell is
   future work. ADR 0006.
2. **Embeddings are a hashing-based pseudo-embedder.** Good enough for
   the in-repo corpus and the explicit Phase-4 test; a one-function swap
   to `@xenova/transformers` + `Xenova/bge-small-en-v1.5` is the upgrade
   path. ADR 0007.
3. **Phase-2 subscribe trust-deposits.** The provider's `POST /api/v1/subscribe`
   doesn't issue a real L402 challenge for the deposit (the market-monitor
   agent uses the same trust-deposit pattern). Real-mode payment for
   subscription opens is deferred — the alert-charging mechanism IS
   correct.
4. **Phase-5 buyer-side fraud slashing isn't implemented.** ADR 0010
   flagged it; the test gate exercises reviewer-side slashing only.
5. **Phase-5 silent re-review sampling isn't running.** The dispute path
   slashes on demand based on user input, not on automated detection.
   This is a v0 trade-off captured in ADR 0010.
6. **Two-step Lightning settlement to a platform NWC is mock-only.** The
   `total_fee_sats` is a counter; an actual NWC payout to the platform
   is deferred (ADR 0008).
7. **Buyer subscription cancel-refund in real mode is not wired.** Mock
   zeroes the balance counter; real-mode NWC payback is deferred.
8. **Existing `npm run test:phase1.js` (single-provider, legacy) is
   untouched.** It still tests the original L402 flow and will pass
   even after rebrand because the existing endpoints / macaroon format
   are frozen.

## Phases skipped

None. Phases 0–7 all completed. (Earlier drafts of this document had
Phase 7 marked skipped.)

## Build blockers

None encountered. Every retry succeeded on first or second attempt.
No `docs/BUILD-BLOCKERS.md` was needed.

## How to run end-to-end

```bash
# Re-install workspaces
npm install

# Build the shared core (required because dist/ is gitignored)
cd packages/andromeda-core && npx tsc -p tsconfig.json && cd ../..

# Run all phase tests sequentially (each spawns / kills its own services)
npm run test:phase0    # 12/12
npm run test:phase1b   # 16/16
npm run test:phase2    # 12/12
npm run test:phase3    # 12/12
npm run test:phase4    # 11/11
npm run test:phase5    # 16/16
npm run test:phase6    # 10/10
npm run test:phase7    # 14/14 (requires registry already running on 3030)
npm run test:mcp       # 12/12 (legacy regression)
```

Mock mode is the default everywhere. Real-mode requires NWC
strings in `provider/.env.local`, `buyer/.env`, and `mcp/.env`.
