// ─────────────────────────────────────────────────────────────────────
//  Persistence — single-file SQLite via better-sqlite3.
//
//  Three tables that survive restart:
//    invoices  — every minted L402 challenge; transitions to consumed.
//    receipts  — paid order-receipts, replayable by id.
//    requests  — analytics + rate-limit observation.
//
//  Path: $LUMEN_DB_PATH (defaults to <repo-root>/lumen.db).
// ─────────────────────────────────────────────────────────────────────

import Database from "better-sqlite3";
import path from "node:path";

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const file = process.env.LUMEN_DB_PATH ?? path.resolve(process.cwd(), "..", "lumen.db");
  _db = new Database(file);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  init(_db);
  return _db;
}

function init(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      payment_hash TEXT PRIMARY KEY,
      macaroon     TEXT NOT NULL,
      resource     TEXT NOT NULL,
      amount_sats  INTEGER NOT NULL,
      created_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      status       TEXT NOT NULL CHECK (status IN ('pending','paid','expired','consumed')),
      preimage     TEXT,
      paid_at      INTEGER,
      consumed_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);

    CREATE TABLE IF NOT EXISTS receipts (
      receipt_id   TEXT PRIMARY KEY,
      claims_json  TEXT NOT NULL,
      signature    TEXT NOT NULL,
      order_id     TEXT NOT NULL,
      buyer        TEXT,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_order ON receipts(order_id);

    CREATE TABLE IF NOT EXISTS requests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id    TEXT NOT NULL,
      ts            INTEGER NOT NULL,
      ip            TEXT,
      endpoint      TEXT NOT NULL,
      status        INTEGER NOT NULL,
      sats_charged  INTEGER NOT NULL DEFAULT 0,
      latency_ms    INTEGER NOT NULL,
      ua            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(ts);
    CREATE INDEX IF NOT EXISTS idx_requests_endpoint ON requests(endpoint);

    -- Phase 2: subscriptions.
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                  TEXT PRIMARY KEY,
      subscriber_pubkey   TEXT NOT NULL,
      service_local_id    TEXT NOT NULL,
      per_event_sats      INTEGER NOT NULL,
      balance_sats        INTEGER NOT NULL,
      config_json         TEXT NOT NULL DEFAULT '{}',
      status              TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled','exhausted')),
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subs_subscriber ON subscriptions(subscriber_pubkey);
    CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);

    CREATE TABLE IF NOT EXISTS subscription_alerts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL,
      payload_json    TEXT NOT NULL,
      signature       TEXT NOT NULL,
      sats_charged    INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_sub ON subscription_alerts(subscription_id, created_at);
  `);
}

// ─── subscriptions ───────────────────────────────────────────────────
export type SubscriptionRow = {
  id: string; subscriber_pubkey: string; service_local_id: string;
  per_event_sats: number; balance_sats: number; config_json: string;
  status: "active" | "cancelled" | "exhausted"; created_at: number; updated_at: number;
};

export function createSubscription(row: {
  id: string; subscriber_pubkey: string; service_local_id: string;
  per_event_sats: number; balance_sats: number; config: Record<string, unknown>;
}) {
  const now = Date.now();
  db().prepare(`
    INSERT INTO subscriptions (id, subscriber_pubkey, service_local_id, per_event_sats, balance_sats, config_json, status, created_at, updated_at)
    VALUES (@id, @subscriber_pubkey, @service_local_id, @per_event_sats, @balance_sats, @config_json, 'active', @now, @now)
  `).run({ ...row, config_json: JSON.stringify(row.config), now });
}

export function getSubscription(id: string): SubscriptionRow | undefined {
  return db().prepare(`SELECT * FROM subscriptions WHERE id = ?`).get(id) as SubscriptionRow | undefined;
}

export function listActiveSubscriptions(service_local_id: string): SubscriptionRow[] {
  return db().prepare(`SELECT * FROM subscriptions WHERE service_local_id = ? AND status = 'active'`)
    .all(service_local_id) as SubscriptionRow[];
}

export function listSubscriptionsForSubscriber(subscriber_pubkey: string): SubscriptionRow[] {
  return db().prepare(`SELECT * FROM subscriptions WHERE subscriber_pubkey = ? ORDER BY created_at DESC`)
    .all(subscriber_pubkey) as SubscriptionRow[];
}

export function cancelSubscription(id: string): { refunded_sats: number } | null {
  const row = getSubscription(id);
  if (!row || row.status !== "active") return null;
  const refunded = row.balance_sats;
  db().prepare(`UPDATE subscriptions SET status = 'cancelled', balance_sats = 0, updated_at = ? WHERE id = ?`)
    .run(Date.now(), id);
  return { refunded_sats: refunded };
}

export function topUpSubscription(id: string, sats: number) {
  const now = Date.now();
  const r = db().prepare(`UPDATE subscriptions SET balance_sats = balance_sats + ?, updated_at = ?, status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END WHERE id = ? AND status != 'cancelled'`)
    .run(sats, now, id);
  return r.changes === 1;
}

/**
 * Atomically debit and emit an alert. Returns:
 *   { ok: true, alert_id, balance_after }     — alert delivered
 *   { ok: false, reason: 'exhausted', balance_after } — funds gone
 *   { ok: false, reason: 'not_active' }
 */
export function debitAndAlert(args: {
  subscription_id: string;
  kind: string;
  payload: Record<string, unknown>;
  signature: string;
}): { ok: true; alert_id: number; balance_after: number; sats_charged: number }
   | { ok: false; reason: "exhausted" | "not_active"; balance_after?: number } {
  const d = db();
  const tx = d.transaction(() => {
    const sub = d.prepare(`SELECT * FROM subscriptions WHERE id = ?`).get(args.subscription_id) as SubscriptionRow | undefined;
    if (!sub) return { ok: false as const, reason: "not_active" as const };
    if (sub.status !== "active") return { ok: false as const, reason: "not_active" as const };

    if (sub.balance_sats < sub.per_event_sats) {
      // Flip to exhausted; emit a single balance_exhausted alert if not already.
      const lastAlert = d.prepare(
        `SELECT kind FROM subscription_alerts WHERE subscription_id = ? ORDER BY created_at DESC LIMIT 1`,
      ).get(args.subscription_id) as { kind: string } | undefined;
      d.prepare(`UPDATE subscriptions SET status = 'exhausted', updated_at = ? WHERE id = ?`).run(Date.now(), args.subscription_id);
      if (lastAlert?.kind !== "balance_exhausted") {
        const r = d.prepare(`
          INSERT INTO subscription_alerts (subscription_id, kind, payload_json, signature, sats_charged, created_at)
          VALUES (?, 'balance_exhausted', ?, ?, 0, ?)
        `).run(args.subscription_id, JSON.stringify({ balance_sats: sub.balance_sats, per_event_sats: sub.per_event_sats }), args.signature, Date.now());
        return { ok: false as const, reason: "exhausted" as const, balance_after: sub.balance_sats };
      }
      return { ok: false as const, reason: "exhausted" as const, balance_after: sub.balance_sats };
    }

    // Debit + insert alert.
    const newBal = sub.balance_sats - sub.per_event_sats;
    d.prepare(`UPDATE subscriptions SET balance_sats = ?, updated_at = ? WHERE id = ?`).run(newBal, Date.now(), args.subscription_id);
    const r = d.prepare(`
      INSERT INTO subscription_alerts (subscription_id, kind, payload_json, signature, sats_charged, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(args.subscription_id, args.kind, JSON.stringify(args.payload), args.signature, sub.per_event_sats, Date.now());
    return { ok: true as const, alert_id: Number(r.lastInsertRowid), balance_after: newBal, sats_charged: sub.per_event_sats };
  });
  return tx();
}

export function listAlerts(subscription_id: string, sinceMs = 0): Array<{
  id: number; kind: string; payload_json: string; signature: string; sats_charged: number; created_at: number;
}> {
  return db().prepare(`SELECT id, kind, payload_json, signature, sats_charged, created_at FROM subscription_alerts WHERE subscription_id = ? AND created_at > ? ORDER BY created_at ASC`)
    .all(subscription_id, sinceMs) as Array<{ id: number; kind: string; payload_json: string; signature: string; sats_charged: number; created_at: number }>;
}

// ─── invoices ────────────────────────────────────────────────────────
export function recordInvoice(row: {
  payment_hash: string; macaroon: string; resource: string; amount_sats: number;
  created_at: number; expires_at: number;
}) {
  db().prepare(`
    INSERT OR IGNORE INTO invoices (payment_hash, macaroon, resource, amount_sats, created_at, expires_at, status)
    VALUES (@payment_hash, @macaroon, @resource, @amount_sats, @created_at, @expires_at, 'pending')
  `).run(row);
}

export function lookupInvoiceRow(payment_hash: string): {
  status: string; consumed_at: number | null; resource: string; amount_sats: number;
} | undefined {
  return db().prepare(
    `SELECT status, consumed_at, resource, amount_sats FROM invoices WHERE payment_hash = ?`,
  ).get(payment_hash) as { status: string; consumed_at: number | null; resource: string; amount_sats: number } | undefined;
}

export function markInvoiceConsumed(payment_hash: string, preimage: string): boolean {
  // single-use: only flips pending|paid -> consumed.
  const r = db().prepare(`
    UPDATE invoices
       SET status = 'consumed', preimage = ?, paid_at = COALESCE(paid_at, ?), consumed_at = ?
     WHERE payment_hash = ? AND status IN ('pending','paid')
  `).run(preimage, Date.now(), Date.now(), payment_hash);
  return r.changes === 1;
}

// ─── receipts ────────────────────────────────────────────────────────
export function recordReceipt(row: {
  receipt_id: string; claims_json: string; signature: string;
  order_id: string; buyer: string | null;
}) {
  db().prepare(`
    INSERT INTO receipts (receipt_id, claims_json, signature, order_id, buyer, created_at)
    VALUES (@receipt_id, @claims_json, @signature, @order_id, @buyer, @created_at)
  `).run({ ...row, created_at: Date.now() });
}

export function getReceipt(receipt_id: string): {
  receipt_id: string; claims_json: string; signature: string; created_at: number;
} | undefined {
  return db().prepare(
    `SELECT receipt_id, claims_json, signature, created_at FROM receipts WHERE receipt_id = ?`,
  ).get(receipt_id) as { receipt_id: string; claims_json: string; signature: string; created_at: number } | undefined;
}

// ─── requests / stats ────────────────────────────────────────────────
export function recordRequest(row: {
  request_id: string; ip: string | null; endpoint: string; status: number;
  sats_charged: number; latency_ms: number; ua: string | null;
}) {
  db().prepare(`
    INSERT INTO requests (request_id, ts, ip, endpoint, status, sats_charged, latency_ms, ua)
    VALUES (@request_id, @ts, @ip, @endpoint, @status, @sats_charged, @latency_ms, @ua)
  `).run({ ...row, ts: Date.now() });
}

export function aggregateStats() {
  const d = db();
  const totals = d.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) AS ok,
      SUM(CASE WHEN status = 402 THEN 1 ELSE 0 END) AS challenges,
      SUM(CASE WHEN status = 401 THEN 1 ELSE 0 END) AS unauthorized,
      SUM(CASE WHEN status = 409 THEN 1 ELSE 0 END) AS replays_blocked,
      SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rate_limited,
      SUM(sats_charged) AS sats_earned
    FROM requests
  `).get() as Record<string, number>;

  const byEndpoint = d.prepare(`
    SELECT endpoint,
           COUNT(*) AS n,
           SUM(sats_charged) AS sats,
           AVG(latency_ms) AS p_avg_ms
      FROM requests
     GROUP BY endpoint
     ORDER BY n DESC
  `).all() as { endpoint: string; n: number; sats: number; p_avg_ms: number }[];

  const invoices = d.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'consumed' THEN 1 ELSE 0 END) AS consumed,
      SUM(CASE WHEN status = 'expired'  THEN 1 ELSE 0 END) AS expired,
      COUNT(*) AS total
    FROM invoices
  `).get() as Record<string, number>;

  const receipts = d.prepare(`SELECT COUNT(*) AS n FROM receipts`).get() as { n: number };

  return { totals, byEndpoint, invoices, receipts: receipts.n };
}
