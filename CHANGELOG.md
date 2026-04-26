# Changelog

## Unreleased — Andromeda

### Phase 6 — Dataset seller + platform fee (2026-04-26)

- New workspace `agents/dataset-seller/` (port 3200). Sells one
  dataset: `noaa-pnw-2015-2025` (NOAA Pacific-Northwest weather archive
  2015–2025) for 5000 sat. L402-paywalled purchase returns a 24h
  HMAC-signed download URL. Free `/preview` endpoint returns 10
  representative rows + provenance.
- Platform fee: every settled tx now includes `platform_fee_sats`
  (default 2% / 200 bps, configurable via `ANDROMEDA_PLATFORM_FEE_BPS`).
  Provider, market-monitor, and dataset-seller all report fees on tx
  records.
- New registry endpoint `GET /api/v1/platform/revenue` (admin-secret
  protected). Returns total_fee_sats and tx_count.
- 3 new MCP tools: `andromeda_browse_datasets`,
  `andromeda_purchase_dataset` (saves to `~/.andromeda/datasets/`),
  `andromeda_list_datasets`.
- ADR 0008 — dataset distribution + platform fee.
- Phase 6 test gate (`scripts/test-phase6.js`) — PASS · 10/10.

### Phase 5 — Honor & peer review (2026-04-26)

- ADR 0010 — peer-review design (blind reviewer assignment, two-sided
  slashing, objective+subjective rubric, base honor + bonus, 90-day
  decay, no agent-companies in v1).
- Registry endpoints (all signed):
    POST /api/v1/sellers/:pubkey/rate          (buyer-signed, requires
                                                tx within 30 days)
    POST /api/v1/reviewers/availability        (reviewer-signed)
    POST /api/v1/reviews/request               (seller-signed; blind
                                                weighted-random reviewer
                                                assignment; 72h deadline)
    GET  /api/v1/reviews/assigned?reviewer_pubkey=
    POST /api/v1/reviews/:id/submit            (reviewer-signed; rubric
                                                validation; +rollup×2
                                                seller honor; 95% escrow
                                                payout, 5% platform cut)
    POST /api/v1/reviews/:id/dispute           (buyer-signed; slashes
                                                reviewer -50, returns
                                                escrow, signed audit log)
- Honor decay: 90-day cutoff × 0.9, runs lazily on every
  `GET /api/v1/sellers/:pubkey` (capped to once per UTC day) and on
  demand via `POST /api/v1/admin/decay?force=1`. Sellers' badges
  (`peer_reviewed`, `review_count`, `max_rollup`) appear in the seller
  GET response.
- Slashing audit log: `slashing_events` table; entries HMAC-signed with
  ANDROMEDA_REGISTRY_SECRET (or L402_SECRET fallback).
- 5 new MCP tools: `andromeda_rate_seller`, `_request_review`,
  `_set_reviewer_availability`, `_check_review_assignments`,
  `_submit_review`.
- MCP buyer now attaches `X-Andromeda-Pubkey` header on paid calls so
  the registry can attribute transactions to a buyer (enables the rate
  path's "tx within 30 days" check).
- Migration `registry/migrations/0002-honor-decay.sql` adds
  `decay_runs` + helpful indexes.
- Phase 5 test gate (`scripts/test-phase5.js`) — PASS · 16/16.

### Phase 4 — Orchestrator (recommend) (2026-04-26)

- New registry endpoint `POST /api/v1/orchestrator/recommend`. Body:
  `{ intent, max_price_sats?, min_honor?, type? }` → ranked array with
  per-factor breakdown.
- Ranking formula: `score = 0.6 * intent_match + 0.2 * honor_normalized
  + 0.2 * price_fit`. Each result includes the four numbers so the
  recommendation is explainable.
- Embeddings: deterministic-hash pseudo-embedding (384-dim Float32, L2-
  normalized). Stored in `services.embedding_blob` BLOB. Backfilled on
  first /recommend call. ADR 0007 captures the choice and the upgrade
  path to `@xenova/transformers` later.
- Excluded results return with `reason: "no service within price"` (or
  similar) so the caller can explain to the user why a service didn't
  appear.
- New MCP tool: `andromeda_recommend(intent, max_price_sats?, min_honor?, type?)`.
- ADR 0007 — pseudo-embedding decision.
- Phase 4 test gate (`scripts/test-phase4.js`) — PASS · 11/11.

### Phase 3 — Local control plane + kill-switch (2026-04-26)

- MCP server gains a localhost-only HTTP control plane (random port,
  bound to 127.0.0.1). Bearer-token auth — token persisted to
  `~/.andromeda/control-token` (`0600` best-effort), port to
  `~/.andromeda/control-port`. Endpoints:
    GET  /healthz                — public probe
    GET  /session                — budget + kill-switch + subs snapshot
    POST /session/budget         — reset cap
    POST /session/kill-switch    — flip
    GET  /events                 — server-sent events (budget, kill_switch)
- Kill-switch flag persists in `.mcp-session.json`. Every paid MCP tool
  hits `reserve(amount)` which now returns `"kill_switch_active"` when
  set, refusing the call before any wallet activity.
- New workspace `dashboard/` with a CLI placeholder
  (`dashboard:cli`) that prints session state. Tauri 2.x GUI is
  deliberately deferred — see ADR 0006 — so we don't add a Rust
  toolchain dependency. `dashboard:tauri:build` is a stub that exits 0.
- ADR 0006 — control plane in MCP, Tauri GUI deferred.
- Phase 3 test gate (`scripts/test-phase3.js`) — PASS · 12/12.

### Phase 2 — Subscriptions & monitoring seller (2026-04-26)

- Provider gains subscription primitives (additive, no break to
  existing endpoints):
    POST /api/v1/subscribe                       (mock-trust deposit)
    GET  /api/v1/subscriptions/:id
    POST /api/v1/subscriptions/:id/topup
    POST /api/v1/subscriptions/:id/cancel
    GET  /api/v1/subscriptions/:id/alerts?since=
    POST /api/dev/fire-alert                     (mock-only)
  New SQLite tables: `subscriptions`, `subscription_alerts`. Atomic
  debit-and-emit transaction (`debitAndAlert`) handles balance
  arithmetic + balance_exhausted edge case.
- New workspace `agents/market-monitor/` — focused JS HTTP service on
  port 3100. Sells `github-advisory-monitor` (50 sat/event, 1000 sat
  default deposit). Self-registers with the registry on boot. Watcher
  loop polls advisories (mock-mode reads `src/fixtures/advisories.json`;
  real-mode polls api.github.com/advisories) and fans alerts out to
  active subscribers matching `watched_repos` + `severity_min`.
- Each alert is HMAC-signed by the seller (over kind+payload).
- 5 new MCP tools (no aliases — Phase 2 only):
    andromeda_subscribe
    andromeda_list_subscriptions
    andromeda_check_alerts
    andromeda_topup_subscription
    andromeda_cancel_subscription
  Local subscription cache persisted to ~/.andromeda/subscriptions.json.
- ADR 0005 — prepaid-balance + polled-alert design.
- Phase 2 test gate (`scripts/test-phase2.js`) — PASS · 12/12.
- Legacy `npm run test:mcp` still PASS · 12/12.

### Phase 1 — Multi-seller registry (2026-04-26)

- New workspace `registry/` (Next.js 16 + better-sqlite3, port 3030).
  Numbered SQL migrations in `registry/migrations/`. Tables: sellers,
  services (+ FTS5 + embedding_blob reserved), transactions, plus stub
  schemas for Phase 5 (reviews, reviewers, review_requests,
  slashing_events).
- Endpoints: `GET /api/v1/health`, `POST /api/v1/sellers/register`
  (signed), `GET /api/v1/sellers`, `GET /api/v1/sellers/:pubkey`,
  `GET /api/v1/sellers/:pubkey/stats`, `GET /api/v1/services`,
  `GET /api/v1/services/search`, `POST /api/v1/transactions/record`
  (seller-signed, idempotent on payment_hash).
- Provider self-registers on first request (lazy boot via `ensureBooted()`).
  Generates an Ed25519 keypair (`ANDROMEDA_PROVIDER_PRIVKEY`) on first
  boot and persists it to `provider/.env.local`. 60-second heartbeat
  re-registers and refreshes `last_active_at`. After every paid call
  settles, fires-and-forgets a tx record to the registry — failures
  logged, never thrown.
- MCP server gains 3 NEW tools (registry-backed):
  - `andromeda_search_services` — full-text search across all sellers,
    filterable by max-price + type.
  - `andromeda_list_sellers` — paginated seller list.
  - `andromeda_discover_all` — multi-provider catalog, filterable.
- All 7 existing MCP tools now register under BOTH
  `andromeda_*` (canonical) AND `lumen_*` (deprecated alias). The alias's
  description carries `[deprecated alias of … — will be removed in a
  future release]`.
- MCP buyer keypair auto-generated on first run and persisted to
  `mcp/.env` as `ANDROMEDA_BUYER_PRIVKEY`.
- ADR 0004 — registry design (Next.js + SQLite FTS5, signed writes).
- Phase 1 test gate (`scripts/test-phase1b.js`) — PASS · 16/16.
- Legacy `npm run test:mcp` still PASS · 12/12 (no regression).

### Phase 0 — Repo hygiene & shared core (2026-04-26)

- Rebrand: project codename LUMEN → **Andromeda**. ADR 0002 captures the
  policy (alias old MCP tool names; accept legacy `LUMEN_*` env vars as
  fallback for one phase).
- ADR 0001 — target architecture overview.
- ADR 0003 — npm workspaces as the monorepo tool.
- New workspace `packages/andromeda-core` with TypeScript modules:
  - `crypto.ts` — Ed25519 keypair gen / sign / verify (`@noble/ed25519`).
  - `signed-request.ts` — Ed25519 signed HTTP requests
    (`X-Andromeda-Pubkey`, `X-Andromeda-Sig`, `X-Andromeda-Timestamp`),
    5-min validity window.
  - `types.ts` — Service, Seller, Subscription, Transaction, Review,
    Macaroon shapes.
  - `l402.ts` — extracted macaroon mint/verify (HMAC format unchanged
    and byte-compat with `provider/src/lib/l402.ts`).
  - `config.ts` — central defaults.
  - `review-rubric.ts` — peer-review rubric definition for Phase 5.
- Workspace stubs added: `registry/`, `dashboard/`, `agents/market-monitor/`,
  `agents/dataset-seller/`, `web/`.
- `.nvmrc` pins Node 20.18.0; `tsconfig.base.json` enables strict mode.
- MCP server (`mcp/lumen-client.js`, `mcp/budget.js`) now reads
  `ANDROMEDA_PROVIDER_URL` / `ANDROMEDA_MCP_STATE_PATH` first, falling
  back to legacy `LUMEN_*` names.
- Phase 0 test gate (`scripts/test-phase0.js`) — 12/12 passing.
- Existing `test:mcp` still passes 12/12 (no regression).
