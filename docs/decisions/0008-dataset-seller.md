# ADR 0008 — Dataset seller + platform fee

Status: Accepted
Date: 2026-04-26

## Context

Phase 6 adds the second non-provider agent (after market-monitor): a
dataset seller selling a single product, the NOAA Pacific-Northwest
weather archive 2015–2025 (~200 MB Parquet). It also flips on the
platform-fee infrastructure: every settled tx records a 2%
platform_fee_sats line.

## Decisions

### Dataset distribution

Mock mode (default):
- The "dataset" is a small JSON fixture (`fixtures/noaa-pnw.json`)
  representing a stand-in for the real Parquet — small enough to ship
  in-repo (~20 KB).
- The free preview endpoint returns the first 100 rows of the fixture.
- The paid purchase endpoint returns a **signed local URL** that's
  valid for 24h and points to a path that resolves to the fixture.

Real mode (later):
- The actual file lives on disk (configured via env). The signed URL
  is a 24h-valid HMAC-signed path.
- We do NOT implement S3 or external storage in v0. The dataset
  ships local-disk-only.

### Pricing

`5000 sats` for a one-time dataset purchase. Platform fee 2% (100 sat).
Free preview returns 100 rows.

### MCP tools

- `andromeda_browse_datasets` — registry-backed search for type=dataset.
- `andromeda_purchase_dataset(seller_pubkey, dataset_id, save_path?)`
  — pays via L402, downloads via the signed URL, saves to
  `~/.andromeda/datasets/<dataset_id>.json` (or user-specified).
- `andromeda_list_datasets` — list local cache.

### Platform-fee infrastructure

- `provider/src/lib/registry-client.ts` (and the market-monitor + dataset-
  seller equivalents) all set `platform_fee_sats = round(amount_sats *
  0.02)` when calling `/api/v1/transactions/record`. Configurable
  per-service-type via `ANDROMEDA_PLATFORM_FEE_BPS` (default 200).
- `GET /api/v1/platform/revenue` — admin-secret protected. Returns
  total_fee_sats and tx_count.
- Two-step settlement (buyer → seller → platform NWC): in v0 mock
  mode this is a counter only. Real-mode requires `PLATFORM_NWC_URL`
  in `registry/.env` to actually pay out — DEFERRED past v0.
