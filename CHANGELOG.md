# Changelog

## Unreleased — Andromeda

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
