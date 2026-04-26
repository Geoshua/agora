# ADR 0002 — Rebrand LUMEN → Andromeda

Status: Accepted
Date: 2026-04-26

## Context

The project codename is changing from **LUMEN** to **Andromeda** for all
new code, env vars, docs, and MCP tools. We must do this without
breaking existing buyers who depend on the current MCP tool names or
`LUMEN_*` env vars.

## Decision

### MCP tools — alias, don't rename

For each of the 7 existing MCP tools, register **both** names with the
same handler:

| Old (deprecated) | New (canonical)   |
|------------------|-------------------|
| `lumen_status`   | `andromeda_status`|
| `lumen_discover` | `andromeda_discover` |
| `lumen_balance`  | `andromeda_balance` |
| `lumen_set_budget` | `andromeda_set_budget` |
| `lumen_verify_listing` | `andromeda_verify_listing` |
| `lumen_file_receipt` | `andromeda_file_receipt` |
| `lumen_fetch_receipt` | `andromeda_fetch_receipt` |

The old name's `description` is prefixed with
`[deprecated alias of andromeda_status — will be removed in a future release]`.

This satisfies principle #4 (existing tool shapes preserved) and the
rebrand at the same time.

### Env vars

New code reads `ANDROMEDA_*` first, falling back to `LUMEN_*` for one
phase before we drop the fallback:

| New                          | Legacy fallback         |
|------------------------------|-------------------------|
| `ANDROMEDA_PROVIDER_URL`     | `LUMEN_PROVIDER_URL`    |
| `ANDROMEDA_DB_PATH`          | `LUMEN_DB_PATH`         |
| `ANDROMEDA_MCP_STATE_PATH`   | `LUMEN_MCP_STATE_PATH`  |
| `ANDROMEDA_PROVIDER_PRIVKEY` | _new_ (no legacy)       |
| `ANDROMEDA_BUYER_PRIVKEY`    | _new_                   |
| `ANDROMEDA_REGISTRY_URL`     | _new_                   |

`MOCK_MODE`, `NWC_URL`, `MAX_PRICE_SATS`, `MAX_BUDGET_SATS`, and
`L402_SECRET` are unchanged (they are not LUMEN-namespaced).

`.env.example` files for new workspaces use only `ANDROMEDA_*`.

### Local state directory

New code writes per-user state to `~/.andromeda/` (created with `0700`
perms on first use):

- `~/.andromeda/config.json` — dashboard config
- `~/.andromeda/control-port` — MCP control-plane port
- `~/.andromeda/control-token` — control-plane auth token (`0600`)
- `~/.andromeda/datasets/` — purchased datasets

The existing buyer-session file at `<repo>/.mcp-session.json` STAYS
WHERE IT IS. Moving it would invalidate active sessions, which violates
working principle #10.

### npm package name

The repo's root `package.json` `name` field stays `lumen`. The npm
package name is internal; renaming it could break the workspace
resolution and the existing `npm run *` scripts. The user-facing brand
is "Andromeda" everywhere — README, CHANGELOG, docs, dashboard UI.

### Database files

The shared SQLite file at `<repo>/lumen.db` stays at that path. New
per-workspace DBs use names like `<repo>/registry.db`,
`<repo>/agents/market-monitor/monitor.db`. We never rename `lumen.db`.

## Consequences

- Existing Claude Desktop config files referencing `lumen_*` tools keep
  working. New users get `andromeda_*` documented.
- Existing `provider/.env.local` keeps working without edits.
- `provider/src/lib/db.ts`'s default DB filename of `lumen.db` is left
  alone for backwards-compat.
- The "lumen" string survives in the npm package name and the legacy db
  path; we treat it as a deprecated implementation detail.

## Migration timeline

- Phase 0 (this phase): Aliases registered; both env names accepted.
- Phase 1–6: Continue accepting `LUMEN_*` fallback.
- Phase 7+ (post-launch): Remove `lumen_*` aliases and `LUMEN_*` env
  fallbacks with a major version bump.
