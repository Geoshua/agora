// ─────────────────────────────────────────────────────────────────────
//  Per-session spending guardrail.
//
//  Behaviour:
//    - At startup, read MAX_BUDGET_SATS from env (default 5000).
//    - For each tool call that costs sats, the caller must check
//      reserve(amount).  If it returns null, the call is allowed and
//      the budget is debited; if it returns a string, the call must
//      be rejected with that string as the reason.
//    - getStatus() returns {budget, spent, remaining} for inclusion
//      in tool responses so the model is always self-aware.
//
//  Persists to <repo>/.mcp-session.json so a budget survives a
//  Claude Desktop reload of the MCP server (otherwise every reload
//  resets the cap, which feels broken).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

// ADR 0002: existing .mcp-session.json stays put (don't invalidate sessions).
// Read new env var first, fall back to legacy LUMEN_MCP_STATE_PATH.
const STATE_PATH =
  process.env.ANDROMEDA_MCP_STATE_PATH ??
  process.env.LUMEN_MCP_STATE_PATH ??
  path.resolve(process.cwd(), "..", ".mcp-session.json");
const MAX = parseInt(process.env.MAX_BUDGET_SATS ?? "5000", 10);

let state = load();

function load() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const j = JSON.parse(raw);
    return { budget: MAX, spent: j.spent ?? 0, started_at: j.started_at ?? Date.now() };
  } catch {
    return { budget: MAX, spent: 0, started_at: Date.now() };
  }
}

function save() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    // budget enforcement is in-memory authoritative; persistence is best-effort.
  }
}

export function getStatus() {
  return {
    budget_sats:    state.budget,
    spent_sats:     state.spent,
    remaining_sats: Math.max(0, state.budget - state.spent),
    started_at:     new Date(state.started_at).toISOString(),
  };
}

/**
 * Check whether `amount` sats can be spent. Returns null if OK; on success
 * the caller must call confirm(amount) once the spend actually happens.
 * Returns a string reason if the spend would breach the cap.
 */
export function reserve(amount) {
  if (amount <= 0) return null;
  if (state.spent + amount > state.budget) {
    return `budget exceeded: would spend ${state.spent + amount} sat against cap ${state.budget} sat (already spent ${state.spent})`;
  }
  return null;
}

/** Record a confirmed spend. */
export function confirm(amount) {
  if (amount <= 0) return;
  state.spent += amount;
  save();
}

/** Reset the budget to a new value. Used by the lumen_set_budget tool. */
export function setBudget(amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("budget must be a positive integer (sats)");
  state.budget = amount;
  state.spent = 0;
  state.started_at = Date.now();
  save();
  return getStatus();
}
