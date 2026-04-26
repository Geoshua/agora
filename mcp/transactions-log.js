// Append-only transaction log at ~/.andromeda/transactions.log (JSONL).
//
// Each line is one JSON object. Columns:
//   ts_ms         number  wall-clock ms when the spend was confirmed
//   kind          string  "verify" | "receipt" | "subscribe" | "topup" | "dataset" | "other"
//   amount_sats   number  sats spent (positive)
//   seller_pubkey string? hex pubkey of the seller, when known
//   seller_name   string? friendly name, when known
//   service       string? local service id, when known
//   note          string? free-text annotation
//
// File is created on first append (no migration, no schema). The dashboard
// reads it via the control plane (GET /transactions).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_DIR = process.env.ANDROMEDA_STATE_DIR ?? path.join(os.homedir(), ".andromeda");
const LOG_FILE = path.join(STATE_DIR, "transactions.log");

function ensureDir() { try { fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 }); } catch {} }

export function appendTransaction(entry) {
  ensureDir();
  const row = {
    ts_ms: Date.now(),
    kind: "other",
    amount_sats: 0,
    ...entry,
  };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(row) + "\n", { mode: 0o600 });
  } catch (e) {
    // best-effort; log to stderr but never throw
    process.stderr.write(`[transactions-log] WARN couldn't append: ${e.message}\n`);
  }
  return row;
}

export function readTransactions(opts = {}) {
  const { limit = 1000 } = opts;
  ensureDir();
  let raw = "";
  try { raw = fs.readFileSync(LOG_FILE, "utf8"); }
  catch { try { fs.writeFileSync(LOG_FILE, "", { mode: 0o600 }); } catch {} ; return []; }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const out = [];
  // Read tail-first; oldest at the bottom.
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { out.push(JSON.parse(lines[i])); } catch {}
  }
  return out;
}

export function transactionsLogPath() { return LOG_FILE; }
