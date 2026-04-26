# ADR 0013 — Rebrand Andromeda → Agora (final project name)

Status: Accepted
Date: 2026-04-26

## Context

The marketplace has been through one prior rebrand (LUMEN → Andromeda,
ADR 0002). The final project name is **Agora** — chosen to evoke the
public marketplace metaphor that the registry + buyer + seller flow
literally implements. This ADR makes Agora canonical everywhere and
demotes Andromeda to a deprecated alias on the same footing as LUMEN.

The rebrand pattern is identical to ADR 0002:

- The signed-call backbone (Ed25519 + 5-min skew window) is unchanged.
- The macaroon HMAC byte-format (ADR 0001 §Consequences) is unchanged.
- Existing endpoint paths and MCP tool shapes are FROZEN. Renames are
  **additive** — old names still register and still work.
- Database schemas (ADR 0001) are unchanged. No SQL migrations.

## Decision

### Naming map

| Layer | Old (Andromeda) | New (Agora) | Backward-compat |
|---|---|---|---|
| MCP tool prefix | `andromeda_*` | `agora_*` | Keep `andromeda_*` AND `lumen_*` as deprecated aliases |
| Env vars | `ANDROMEDA_*` | `AGORA_*` | Read `AGORA_*` first, fall back to `ANDROMEDA_*`, then `LUMEN_*` |
| Signed-request HTTP headers | `X-Andromeda-Pubkey/Sig/Timestamp` | `X-Agora-Pubkey/Sig/Timestamp` | Verifier accepts EITHER family on incoming requests; outgoing requests send `X-Agora-*` only |
| npm package | `@andromeda/core` | `@agora/core` | Rename + update all imports + reinstall workspaces |
| Workspace directory | `packages/andromeda-core/` | `packages/agora-core/` | Move directory, update `workspaces` array in root package.json |
| Local state directory | `~/.andromeda/` | `~/.agora/` | On first read, if `~/.agora/` is absent and `~/.andromeda/` exists, copy contents over (one-shot migration). Don't delete the old dir. |
| Discovery schema | `andromeda.directory.v1` | `agora.directory.v1` | Emit new; parser accepts both |
| Service `service` field on `/api/health` | `andromeda-registry`, `andromeda-market-monitor`, `andromeda-dataset-seller` | `agora-registry`, `agora-market-monitor`, `agora-dataset-seller` | Just rename |
| ADRs / docs / CHANGELOG / README | "Andromeda" branding | "Agora" branding | Replace |
| Root npm `name` field | currently `lumen` (ADR 0002 kept it for npm determinism) | leave as `lumen` — see below | unchanged |
| GitHub repo URL | `github.com/ouazmourad/lumen.git` | leave alone (user's call via GitHub UI) | not in scope |

### MCP tools — three-name registration

For every existing tool, register up to three names that resolve to the
same handler:

- **canonical**: `agora_*`
- **deprecated alias**: `andromeda_*` (was canonical pre-ADR 0013)
- **deprecated alias**: `lumen_*` (was canonical pre-ADR 0002, only for
  the original 7 tools that pre-dated Phase 1)

The deprecated aliases' descriptions are prefixed with
`[deprecated alias of agora_<name> — will be removed in a future release]`
so MCP hosts can surface the warning to humans / models.

Newer tools introduced in Phase 1+ get registered under `agora_*` plus
their `andromeda_*` rebrand-1 alias only (no `lumen_*` alias because the
LUMEN era ended before those tools existed). The orphan `lumen_*` aliases
that survive are exactly the original seven from ADR 0002:
status, discover, balance, set_budget, verify_listing, file_receipt,
fetch_receipt.

### Env vars

Resolution chain on every read: `AGORA_X` → `ANDROMEDA_X` → `LUMEN_X`.
First defined wins. The shared helper lives in `@agora/core/env`
(`readEnv`, `readEnvOr`). Components that don't import the core directly
inline the same chain.

`MOCK_MODE`, `NWC_URL`, `MAX_PRICE_SATS`, `MAX_BUDGET_SATS`, `L402_SECRET`
are **unchanged** — they were never namespaced.

`.env.example` files in each workspace use only `AGORA_*`.

### Signed-request HTTP headers

Outgoing signed requests emit only:
```
X-Agora-Pubkey
X-Agora-Timestamp
X-Agora-Sig
```
Incoming verifier accepts THREE families, in this preference order:
1. `X-Agora-*` (canonical)
2. `X-Andromeda-*` (rebrand-1 legacy)
3. `X-Lumen-*` (pre-rebrand legacy)

The `VerifyResult` type now carries a `family` discriminator so the
receiver can log how a request was signed (useful for spotting clients
that haven't upgraded). All three header sets sign the same canonical
string (`<METHOD>\n<PATH>\n<sha256-of-body>\n<TIMESTAMP>`); the verifier
chooses whichever family is fully present and validates against that.

A naked `x-agora-pubkey` (the buyer-attribution header used by paid
endpoints to record transactions) is also accepted by every endpoint
that previously read `x-andromeda-pubkey` / `x-lumen-pubkey`.

### Local state directory

Canonical: `~/.agora/`. Created with mode `0700` on first use.

On first read by any Agora component (MCP, control-plane CLI,
dashboard), if `~/.agora/` does not exist but `~/.andromeda/` does, the
contents of `~/.andromeda/` are recursively copied into `~/.agora/`. A
marker file `~/.agora/MIGRATED-FROM-ANDROMEDA` is dropped to make the
event auditable. **The legacy directory is NOT deleted** — working
principle #10 (no destructive migrations).

The override env is `AGORA_STATE_DIR`, falling back to
`ANDROMEDA_STATE_DIR` then `LUMEN_STATE_DIR`. If any override is set the
migration is skipped (the override is the user's explicit choice).

The existing buyer-session file at `<repo>/.mcp-session.json` STAYS
WHERE IT IS, exactly as ADR 0002 ruled.

### Root npm `name` field — UNCHANGED, still `lumen`

ADR 0002 left the root `package.json#name` as `lumen` because npm
workspace resolution is name-keyed and the project ships no published
package. We honour that decision unchanged here. Renaming it would:

- bust every CI / dev-machine `node_modules/` lockfile-pin without an
  observable user benefit (no one imports the root package);
- force a fresh `npm install` on every contributor machine right when
  Phase 0 has stabilized;
- have zero effect on the user-facing brand, which is "Agora" everywhere
  visible (README, dashboard, web index, MCP tool prefix).

The root `description` field IS updated to read
"Agora (formerly Andromeda, formerly LUMEN) — agents pay agents over
Lightning."

The internal workspace package names DO change:
`@andromeda/core` → `@agora/core`, etc. (See "npm package" row in the
naming map.) This was free at the workspace level — the lockfile picks
up the rename on `npm install`.

### Database tables / columns — UNCHANGED

The shared SQLite file at `<repo>/lumen.db` and per-workspace DBs
(`registry.db`, `monitor.db`) keep their filenames. Table names
(`sellers`, `services`, `transactions`, `reviews`, …) and column names
(`buyer_pubkey`, `seller_pubkey`, `payment_hash`, …) are unchanged. None
of those names contain "andromeda" or "lumen" — they're domain terms,
not branding. No migration needed.

### GitHub repo URL — out of scope

The remote URL stays `github.com/ouazmourad/lumen.git`. If the user
wants `github.com/ouazmourad/agora.git` they can rename via GitHub's UI;
git history and existing PR/issue links continue to work via GitHub's
permanent redirect. Not this ADR's job.

## Consequences

- Every existing MCP host config (Claude Desktop, Cursor, Claude Code)
  that references `lumen_*` or `andromeda_*` tool names continues to
  work without edit. New configs should reference `agora_*`.
- Every existing buyer that signs requests with `X-Andromeda-*` or even
  `X-Lumen-*` headers continues to work without edit. New buyers should
  send `X-Agora-*`.
- Existing `provider/.env.local` and `mcp/.env` files containing
  `ANDROMEDA_BUYER_PRIVKEY` / `ANDROMEDA_PROVIDER_PRIVKEY` continue to
  work. New auto-generated keys are written under `AGORA_*` names.
- The `lumen` and `andromeda` strings survive in: the root npm package
  name, the legacy `lumen.db` filename, the docs/decisions/0001-0002
  ADRs (which are about the previous rebrands and are not rewritten),
  and the dataset-seller's hard-coded fixture id `noaa-pnw-2015-2025`.

## Migration timeline

- This phase: All three names registered everywhere. Tests assert all
  three families work.
- One major-version bump from now: drop `lumen_*` MCP tool aliases and
  `LUMEN_*` env-var fallbacks. Keep `andromeda_*` for one more cycle.
- Two major-version bumps from now: drop `andromeda_*` aliases.

## Test coverage

The Phase 0 gate now asserts:
- The legacy `packages/andromeda-core/` directory has been removed.
- `@agora/core` typechecks, builds, and exports `HDR_PUBKEY` ===
  `x-agora-pubkey` plus all six legacy header constants.
- The MCP env-var fallback chain reads AGORA_* first.

Phase 1b asserts:
- All ten `agora_*` canonical tools registered.
- All ten `andromeda_*` deprecated aliases registered (with deprecated
  marker in description).
- All seven `lumen_*` deprecated aliases registered (with deprecated
  marker in description).
- The registry rejects tampered `X-Agora-*` AND `X-Andromeda-*`
  signatures with 401 (proves both header families are recognized).
- A paid `agora_verify_listing` call lands a transaction in seller
  stats — proving canonical headers are accepted end-to-end.
- The `lumen_status` and `andromeda_status` aliases both return the
  same shape as `agora_status`.

Phases 2–7 add at least one canonical-and-alias assertion per phase so
no rebrand regression slips through.

## Open questions

None. The pattern is mechanical and the tests are exhaustive.
