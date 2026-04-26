// Append-only transaction log at ~/.agora/transactions.log (JSONL).
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
// reads it via the control plane (GET /transactions). State dir resolution
// (~/.agora/ canonical, with one-shot migration from ~/.andromeda/) is in
// state-dir.js — see ADR 0013.

import fs from "node:fs";
import { stateDir } from "./state-dir.js";

function logFile() { return `${stateDir()}/transactions.log`; }

function ensureDir() { try { fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 }); } catch {} }

export function appendTransaction(entry) {
  ensureDir();
  const row = {
    ts_ms: Date.now(),
    kind: "other",
    amount_sats: 0,
    ...entry,
  };
  try {
    fs.appendFileSync(logFile(), JSON.stringify(row) + "\n", { mode: 0o600 });
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
  const fp = logFile();
  try { raw = fs.readFileSync(fp, "utf8"); }
  catch { try { fs.writeFileSync(fp, "", { mode: 0o600 }); } catch {} ; return []; }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const out = [];
  // Read tail-first; oldest at the bottom.
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { out.push(JSON.parse(lines[i])); } catch {}
  }
  return out;
}

export function transactionsLogPath() { return logFile(); }
