-- Phase 5: per-service "peer-reviewed" derivation needs no schema, but
-- we add a decay_runs table for the lazy daily decay job + a few extras.

CREATE TABLE IF NOT EXISTS decay_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at INTEGER NOT NULL,
  affected_count INTEGER NOT NULL DEFAULT 0
);

-- review_requests already exists from migration 0001; ensure it has
-- the columns Phase 5 expects.
-- (No-op ALTERs are guarded by CREATE TABLE IF NOT EXISTS in 0001.)

CREATE INDEX IF NOT EXISTS idx_review_requests_subject ON review_requests(subject_pubkey);
CREATE INDEX IF NOT EXISTS idx_review_requests_reviewer ON review_requests(reviewer_pubkey);
CREATE INDEX IF NOT EXISTS idx_slashing_target ON slashing_events(target_pubkey);
