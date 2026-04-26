# ADR 0001 — Architecture overview & working principles

Status: Accepted
Date: 2026-04-26

## Context

LUMEN began as a single-provider, single-buyer L402 demo for the SPIRAL ×
Hack-Nation Challenge 02. We are now extending it ("Andromeda") into a
multi-seller marketplace with peer review, subscriptions, datasets, and a
local desktop dashboard. The original code must keep working; existing
endpoints and macaroon formats are frozen.

## Decision

The target architecture has five primary components, each with a single
source of truth for its concern:

```
                      ┌─────────────────────────┐
                      │  Andromeda Registry     │  sellers + tx ledger + reviews
                      │  (Next.js + SQLite)     │
                      └────┬───────────────┬────┘
                           ▲               ▲
              register / record-tx         │ search / recommend
                           │               │
   ┌──────────────┐  ┌─────┴────────┐  ┌───┴──────────┐  ┌──────────────┐
   │  Provider    │  │  Monitor     │  │  Dataset     │  │  ... future  │
   │  (vision-    │  │  (market-    │  │  seller      │  │              │
   │   oracle-3)  │  │   monitor)   │  │              │  │              │
   └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
                                          ▲
                                          │ HTTP + Lightning
                                          │
                              ┌───────────┴───────────┐
                              │  MCP Server (mcp/)    │  buyer-side, per-host
                              │  + budget guardrails  │
                              └───────────┬───────────┘
                                          │ stdio
                              ┌───────────┴───────────┐
                              │  Claude / Cursor      │
                              └───────────┬───────────┘
                                          │ localhost HTTP
                              ┌───────────┴───────────┐
                              │  Dashboard (Tauri)    │  human override
                              └───────────────────────┘
```

### Identity

Every Andromeda actor (seller, provider, buyer) is identified by an
**Ed25519 public key**. There are no email addresses, no passwords, no
accounts. A keypair is generated on first run and persisted locally
(provider stores in its `.env.local`, buyer in `mcp/.env`). The public
key is the agent's globally unique ID.

### Cross-service auth

Every cross-service call carries three headers:

```
X-Andromeda-Pubkey:    <hex Ed25519 pub>
X-Andromeda-Timestamp: <unix-ms>
X-Andromeda-Sig:       <hex Ed25519 sig>
```

The signature is over the canonical string
`<METHOD>\n<PATH>\n<SHA256-of-body-or-empty-string>\n<TIMESTAMP>`.
Signatures expire after **5 minutes** of clock skew. The receiver verifies
the signature and rejects on any mismatch.

This replaces both API keys and per-actor passwords. It also means the
registry's "is this seller legit?" check is just "did they sign this
update with the same key they registered with?".

### Source of truth

| Concern                  | Owner                         |
|--------------------------|-------------------------------|
| Seller registry / catalog| Registry                      |
| Service catalog          | Each provider (canonical) + Registry (cached, embedding-indexed) |
| Transactions ledger      | Registry (settlement layer)   |
| Per-buyer subscriptions  | Provider that sold it         |
| Honor / reviews          | Registry                      |
| Local buyer session      | MCP server (`~/.andromeda/`)  |
| Wallet state             | NWC backend (Alby Hub etc.)   |

### Payment rails

Lightning via NWC (`@getalby/sdk`) is the only payment rail. Mock mode
remains the default and stays usable forever — every paid endpoint must
have a mock path. `MOCK_MODE=false` is opt-in.

### Persistence

Each component owns its own SQLite database. Schema changes happen via
numbered `migrations/NNNN-*.sql` files. There is no shared DB.

## Working principles (non-negotiable)

1. Mock mode must keep working. Every change ships with `MOCK_MODE=true`
   intact. Real-mode is opt-in.
2. No accounts, no passwords, no email. Identity is an Ed25519 keypair.
   Signatures expire after 5 minutes.
3. Single source of truth per concern. Never duplicate.
4. Existing endpoints (`/api/v1/listing-verify`, `/api/v1/order-receipt`,
   `/api/v1/discovery`) and existing MCP tool shapes are frozen.
   Additive only.
5. Schema changes via numbered SQL migrations.
6. Test before merge. Each phase ships `scripts/test-phaseN.js` that
   exits 0 on pass.
7. Document as you go (CHANGELOG + README + ADRs).
8. Non-trivial choices get an ADR.
9. New code is TypeScript. Existing JS stays JS unless materially
   modified.
10. Stop and ask before destructive changes (anything that invalidates
    `.mcp-session.json`, wallet keys, or macaroon secrets).

## Consequences

- The macaroon HMAC format from `provider/src/lib/l402.ts` must NOT
  change. We extract it to `packages/andromeda-core/l402.ts` for sharing.
- Every paid endpoint will carry an extra fire-and-forget call to the
  registry to record the transaction, but that call is non-blocking and
  must not break the response if registry is down.
- The MCP server gets a localhost-only HTTP control-plane in Phase 3 so
  the Tauri dashboard can read/override budget and kill-switch.
