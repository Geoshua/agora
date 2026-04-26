# ADR 0004 — Registry: Next.js + SQLite (FTS5), signed writes

Status: Accepted
Date: 2026-04-26

## Context

Phase 1 introduces a multi-seller registry that holds the seller catalog
and the cross-provider transaction ledger. It's the first multi-actor
piece of Andromeda.

## Decision

- **Framework**: Next.js 16 (App Router), matching the existing provider
  for consistency. Express was considered but adds a second style of
  HTTP server in the repo for marginal benefit.
- **Storage**: `better-sqlite3` (same as provider). SQLite FTS5 for
  full-text search; embeddings (Phase 4) live as BLOBs alongside.
- **Schema migrations**: numbered `registry/migrations/NNNN-*.sql`
  files, applied in order at boot. `_migrations` table tracks applied.
- **Writes are signed**: all `POST` endpoints verify
  `X-Andromeda-Sig`/`Pubkey`/`Timestamp` against the request. Reads
  (`GET`) are public.
- **Port**: defaults to 3030 (provider keeps 3000).
- **Database file**: `<repo>/registry.db` so it sits next to `lumen.db`.
- **Self-registration semantics**: `POST /v1/sellers/register` is
  upsert-by-pubkey. The seller signs the body so a stranger can't
  hijack a seller's row.
- **Tx recording**: `POST /v1/transactions/record` is signed by the
  SELLER (because the seller knows the payment_hash and amount; the
  buyer's identity is just a pubkey field in the body). Idempotent on
  payment_hash.

## Schema

```
sellers          (pubkey PK, name, url, honor, description, registered_at, last_active_at)
services         (id PK, seller_pubkey FK, local_id, name, description, type, tags_json,
                  price_sats, p50_ms, endpoint, embedding_blob, updated_at,
                  UNIQUE(seller_pubkey, local_id))
services_fts     (FTS5 virtual table; mirrors services.name + description + tags_json)
transactions     (id PK, buyer_pubkey, seller_pubkey, service_id, amount_sats,
                  platform_fee_sats, payment_hash UNIQUE, settled_at)
reviews          (id PK, subject_pubkey, reviewer_pubkey, request_id,
                  scores_json, justifications_json, submitted_at)
reviewers        (pubkey PK, available, last_assigned_at)            -- Phase 5
review_requests  (id PK, requester_pubkey, subject_pubkey, escrow_sats,
                  reviewer_pubkey, status, created_at, ...)          -- Phase 5
slashing_events  (id PK, target_pubkey, reason, evidence_json, ...)  -- Phase 5
```

## Consequences

- `embedding_blob` exists from day 1 but stays `NULL` until Phase 4
  populates it. No migration needed in Phase 4 itself.
- The registry is a single point of failure for catalog reads. Mitigated
  by: providers also expose `/api/v1/discovery` (single-seller), so the
  MCP buyer can always fall back to a known seller URL.
- We don't yet implement the platform-fee NWC payout — that's Phase 6.
  Phase 1 records `platform_fee_sats: 0` on every transaction.

## Heartbeats

Providers self-register on startup and re-register every 60 seconds
(updates `last_active_at`). That gives the registry a freshness signal
without requiring a separate "list of online providers" table.
