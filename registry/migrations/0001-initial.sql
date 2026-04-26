-- Andromeda registry — initial schema.

CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sellers (
  pubkey         TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,
  honor          REAL NOT NULL DEFAULT 0,
  description    TEXT,
  registered_at  INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sellers_honor ON sellers(honor DESC);

CREATE TABLE IF NOT EXISTS services (
  id              TEXT PRIMARY KEY,
  seller_pubkey   TEXT NOT NULL REFERENCES sellers(pubkey) ON DELETE CASCADE,
  local_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  type            TEXT NOT NULL,
  tags_json       TEXT NOT NULL DEFAULT '[]',
  price_sats      INTEGER NOT NULL,
  p50_ms          INTEGER,
  endpoint        TEXT NOT NULL,
  embedding_blob  BLOB,             -- populated in Phase 4
  updated_at      INTEGER NOT NULL,
  UNIQUE(seller_pubkey, local_id)
);
CREATE INDEX IF NOT EXISTS idx_services_seller ON services(seller_pubkey);
CREATE INDEX IF NOT EXISTS idx_services_type ON services(type);
CREATE INDEX IF NOT EXISTS idx_services_price ON services(price_sats);

CREATE VIRTUAL TABLE IF NOT EXISTS services_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  tags
);

CREATE TABLE IF NOT EXISTS transactions (
  id                TEXT PRIMARY KEY,
  buyer_pubkey      TEXT NOT NULL,
  seller_pubkey     TEXT NOT NULL,
  service_id        TEXT NOT NULL,
  amount_sats       INTEGER NOT NULL,
  platform_fee_sats INTEGER NOT NULL DEFAULT 0,
  payment_hash      TEXT NOT NULL UNIQUE,
  settled_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_seller ON transactions(seller_pubkey, settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_buyer ON transactions(buyer_pubkey, settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_service ON transactions(service_id);

-- Phase 5 stub schema. Empty in Phase 1 but shape is fixed.
CREATE TABLE IF NOT EXISTS reviews (
  id                  TEXT PRIMARY KEY,
  subject_pubkey      TEXT NOT NULL,
  reviewer_pubkey     TEXT NOT NULL,
  request_id          TEXT,
  scores_json         TEXT NOT NULL,
  justifications_json TEXT NOT NULL,
  submitted_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_subject ON reviews(subject_pubkey);

CREATE TABLE IF NOT EXISTS reviewers (
  pubkey            TEXT PRIMARY KEY,
  available         INTEGER NOT NULL DEFAULT 0,
  last_assigned_at  INTEGER
);

CREATE TABLE IF NOT EXISTS review_requests (
  id                  TEXT PRIMARY KEY,
  requester_pubkey    TEXT NOT NULL,
  subject_pubkey      TEXT NOT NULL,
  service_id          TEXT,
  escrow_sats         INTEGER NOT NULL,
  reviewer_pubkey     TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  deadline_at         INTEGER NOT NULL,
  created_at          INTEGER NOT NULL,
  resolved_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_review_requests_status ON review_requests(status);

CREATE TABLE IF NOT EXISTS slashing_events (
  id              TEXT PRIMARY KEY,
  target_pubkey   TEXT NOT NULL,
  reason          TEXT NOT NULL,
  evidence_json   TEXT NOT NULL,
  honor_delta     REAL NOT NULL,
  signature       TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
