// Andromeda registry — SQLite persistence with numbered migrations.

import Database from "better-sqlite3";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let _db: Database.Database | null = null;

function migrationsDir(): string {
  // We compile via Next.js so __dirname isn't reliable. Walk up from cwd
  // to find a sibling `migrations/` folder.
  // In `next dev` cwd is the registry/ workspace.
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "migrations"),
    path.join(cwd, "registry", "migrations"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`migrations dir not found; tried: ${candidates.join(", ")}`);
}

export function db(): Database.Database {
  if (_db) return _db;
  const file = process.env.ANDROMEDA_REGISTRY_DB_PATH ?? path.resolve(process.cwd(), "..", "registry.db");
  _db = new Database(file);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  applyMigrations(_db);
  return _db;
}

function applyMigrations(d: Database.Database) {
  d.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  const dir = migrationsDir();
  const files = readdirSync(dir).filter(f => /^\d{4}-.*\.sql$/.test(f)).sort();
  const applied = new Set(
    (d.prepare("SELECT id FROM _migrations").all() as { id: number }[]).map(r => r.id),
  );
  for (const f of files) {
    const id = parseInt(f.slice(0, 4), 10);
    if (applied.has(id)) continue;
    const sql = readFileSync(path.join(dir, f), "utf8");
    d.exec(sql);
    d.prepare("INSERT INTO _migrations(id, applied_at) VALUES (?, ?)").run(id, Date.now());
    process.stderr.write(`[registry] migration applied: ${f}\n`);
  }
}

// ─── seller helpers ──────────────────────────────────────────────────
export type SellerRow = {
  pubkey: string; name: string; url: string; honor: number;
  description: string | null; registered_at: number; last_active_at: number;
};

export function upsertSeller(row: {
  pubkey: string; name: string; url: string; description?: string;
}) {
  const now = Date.now();
  db().prepare(`
    INSERT INTO sellers (pubkey, name, url, honor, description, registered_at, last_active_at)
    VALUES (@pubkey, @name, @url, 0, @description, @now, @now)
    ON CONFLICT(pubkey) DO UPDATE SET
      name = excluded.name,
      url = excluded.url,
      description = excluded.description,
      last_active_at = @now
  `).run({ ...row, description: row.description ?? null, now });
}

export function getSeller(pubkey: string): SellerRow | undefined {
  return db().prepare(`SELECT * FROM sellers WHERE pubkey = ?`).get(pubkey) as SellerRow | undefined;
}

export function listSellers(opts: { limit?: number; offset?: number } = {}): SellerRow[] {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  return db().prepare(`SELECT * FROM sellers ORDER BY last_active_at DESC LIMIT ? OFFSET ?`).all(limit, offset) as SellerRow[];
}

export function bumpLastActive(pubkey: string) {
  db().prepare(`UPDATE sellers SET last_active_at = ? WHERE pubkey = ?`).run(Date.now(), pubkey);
}

// ─── services ────────────────────────────────────────────────────────
export type ServiceRow = {
  id: string; seller_pubkey: string; local_id: string; name: string;
  description: string; type: string; tags_json: string;
  price_sats: number; p50_ms: number | null; endpoint: string;
  embedding_blob: Buffer | null; updated_at: number;
};

export function upsertService(row: {
  seller_pubkey: string; local_id: string; name: string; description: string;
  type: string; tags: string[]; price_sats: number; p50_ms?: number; endpoint: string;
}): { id: string } {
  const id = `${row.seller_pubkey.slice(0, 8)}:${row.local_id}`;
  const now = Date.now();
  const tags_json = JSON.stringify(row.tags ?? []);
  db().prepare(`
    INSERT INTO services (id, seller_pubkey, local_id, name, description, type, tags_json, price_sats, p50_ms, endpoint, updated_at)
    VALUES (@id, @seller_pubkey, @local_id, @name, @description, @type, @tags_json, @price_sats, @p50_ms, @endpoint, @now)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      type = excluded.type,
      tags_json = excluded.tags_json,
      price_sats = excluded.price_sats,
      p50_ms = excluded.p50_ms,
      endpoint = excluded.endpoint,
      updated_at = @now
  `).run({ ...row, id, p50_ms: row.p50_ms ?? null, tags_json, now });

  // Refresh FTS.
  db().prepare(`DELETE FROM services_fts WHERE id = ?`).run(id);
  db().prepare(`INSERT INTO services_fts (id, name, description, tags) VALUES (?, ?, ?, ?)`)
    .run(id, row.name, row.description, (row.tags ?? []).join(" "));

  return { id };
}

export function listServices(opts: {
  type?: string; tag?: string; max_price_sats?: number; seller_pubkey?: string;
  limit?: number; offset?: number;
} = {}): ServiceRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.type) { where.push(`type = @type`); params.type = opts.type; }
  if (opts.max_price_sats !== undefined) { where.push(`price_sats <= @max_price_sats`); params.max_price_sats = opts.max_price_sats; }
  if (opts.seller_pubkey) { where.push(`seller_pubkey = @seller_pubkey`); params.seller_pubkey = opts.seller_pubkey; }
  if (opts.tag) { where.push(`tags_json LIKE @tag_like`); params.tag_like = `%"${opts.tag}"%`; }
  const sql = `SELECT * FROM services ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT @limit OFFSET @offset`;
  params.limit = Math.min(opts.limit ?? 100, 500);
  params.offset = opts.offset ?? 0;
  return db().prepare(sql).all(params) as ServiceRow[];
}

export function searchServices(q: string, limit = 20): ServiceRow[] {
  if (!q || q.trim().length === 0) return [];
  // Sanitize for FTS5 — strip everything but words and spaces; quote each token.
  const tokens = q.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(t => t.length > 1);
  if (tokens.length === 0) return [];
  const ftsQuery = tokens.map(t => `"${t}"*`).join(" OR ");
  const ids = db().prepare(`
    SELECT id FROM services_fts WHERE services_fts MATCH ? ORDER BY rank LIMIT ?
  `).all(ftsQuery, limit) as { id: string }[];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db().prepare(`SELECT * FROM services WHERE id IN (${placeholders})`).all(...ids.map(r => r.id)) as ServiceRow[];
}

export function getService(id: string): ServiceRow | undefined {
  return db().prepare(`SELECT * FROM services WHERE id = ?`).get(id) as ServiceRow | undefined;
}

export function setServiceEmbedding(id: string, embedding: Buffer): void {
  db().prepare(`UPDATE services SET embedding_blob = ? WHERE id = ?`).run(embedding, id);
}

// ─── transactions ────────────────────────────────────────────────────
export type TxRow = {
  id: string; buyer_pubkey: string; seller_pubkey: string; service_id: string;
  amount_sats: number; platform_fee_sats: number; payment_hash: string; settled_at: number;
};

export function recordTransaction(row: {
  id: string; buyer_pubkey: string; seller_pubkey: string; service_id: string;
  amount_sats: number; platform_fee_sats: number; payment_hash: string; settled_at?: number;
}): { inserted: boolean } {
  const r = db().prepare(`
    INSERT OR IGNORE INTO transactions
      (id, buyer_pubkey, seller_pubkey, service_id, amount_sats, platform_fee_sats, payment_hash, settled_at)
    VALUES (@id, @buyer_pubkey, @seller_pubkey, @service_id, @amount_sats, @platform_fee_sats, @payment_hash, @settled_at)
  `).run({ ...row, settled_at: row.settled_at ?? Date.now() });
  return { inserted: r.changes > 0 };
}

export function sellerStats(pubkey: string): { tx_count: number; sats_earned: number } {
  const r = db().prepare(`
    SELECT COUNT(*) as tx_count, COALESCE(SUM(amount_sats), 0) as sats_earned
    FROM transactions WHERE seller_pubkey = ?
  `).get(pubkey) as { tx_count: number; sats_earned: number };
  return r;
}

export function platformRevenue(): { total_fee_sats: number; tx_count: number } {
  const r = db().prepare(`
    SELECT COUNT(*) as tx_count, COALESCE(SUM(platform_fee_sats), 0) as total_fee_sats
    FROM transactions
  `).get() as { tx_count: number; total_fee_sats: number };
  return r;
}
