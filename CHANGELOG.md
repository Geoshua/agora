# Changelog

## Unreleased — Andromeda

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
