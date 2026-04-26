// MCP-side subscription state — caches { subscription_id → seller_url }
// so subsequent check_alerts calls don't have to look up the seller
// each time.
//
// Persists to ~/.andromeda/subscriptions.json (per-user state).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_DIR = process.env.ANDROMEDA_STATE_DIR ?? path.join(os.homedir(), ".andromeda");
const STATE_FILE = path.join(STATE_DIR, "subscriptions.json");

function ensureDir() { try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch {} }
function load() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function save(state) {
  ensureDir();
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
}

export function remember(subscription_id, info) {
  const s = load();
  s[subscription_id] = { ...info, last_seen_alert_ms: 0, ...s[subscription_id], ...info };
  save(s);
}

export function forget(subscription_id) {
  const s = load();
  delete s[subscription_id];
  save(s);
}

export function lookup(subscription_id) {
  return load()[subscription_id] ?? null;
}

export function listAll() {
  return load();
}

export function bumpSinceMs(subscription_id, lastMs) {
  const s = load();
  if (s[subscription_id]) {
    s[subscription_id].last_seen_alert_ms = lastMs;
    save(s);
  }
}
