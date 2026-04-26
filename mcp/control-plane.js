// Localhost-only HTTP control plane for the MCP server.
//
// Lets a desktop dashboard (or a curl) read session state and flip the
// kill-switch / reset the budget without restarting the MCP. Binds to
// 127.0.0.1 only. Bearer-token auth — token is 32 bytes hex, stored
// 0600 at ~/.andromeda/control-token. Bound port is written to
// ~/.andromeda/control-port.
//
// Endpoints (all require Authorization: Bearer <token> except /healthz):
//
//   GET  /healthz                     — liveness probe (no auth)
//   GET  /session                     — full session snapshot
//   POST /session/budget {sats}       — reset budget cap
//   POST /session/kill-switch {active}— flip kill switch
//   GET  /events                      — server-sent events stream
//
//   ── Phase 3-UI proxies (additive; ADR 0011) ───────────────────────
//   GET  /balance                     — wallet balance via NWC (proxied)
//   GET  /transactions                — ~/.andromeda/transactions.log
//   GET  /subscriptions               — aggregated subscription state
//   POST /subscriptions/:id/cancel    — proxy to seller cancel
//   GET  /sellers                     — proxy to registry /api/v1/sellers
//
// CORS: a single dev origin is allowed (http://localhost:5173 — Vite default).
// We deliberately do NOT use `*`. ADR 0011.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { getStatus as budgetStatus, setBudget, getKillSwitch, setKillSwitch } from "./budget.js";
import * as subs from "./subscriptions.js";
import { readTransactions, transactionsLogPath } from "./transactions-log.js";

const STATE_DIR = process.env.ANDROMEDA_STATE_DIR ?? path.join(os.homedir(), ".andromeda");
const PORT_FILE = path.join(STATE_DIR, "control-port");
const TOKEN_FILE = path.join(STATE_DIR, "control-token");

// ── CORS ──────────────────────────────────────────────────────────────
// One allowed dev origin. Tauri shell would add `tauri://localhost` here.
// Comma-separated override via env for tests / packaging.
const ALLOWED_ORIGINS = (
  process.env.ANDROMEDA_DASHBOARD_ORIGINS ?? "http://localhost:5173"
).split(",").map(s => s.trim()).filter(Boolean);

// ── registry URL (used by /sellers and balance proxies) ───────────────
const REGISTRY_URL =
  process.env.ANDROMEDA_REGISTRY_URL ??
  "http://localhost:3030";

let _server = null;
let _token = null;
let _port = null;

function ensureDir() { try { fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 }); } catch {} }

function loadOrMintToken() {
  ensureDir();
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (t.length === 64) return t;
  } catch {}
  const t = randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
    // On windows mode is best-effort.
  } catch (e) {
    process.stderr.write(`[control-plane] WARN couldn't persist token: ${e.message}\n`);
  }
  return t;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-max-age", "600");
    return true;
  }
  return false;
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function checkAuth(req) {
  const h = req.headers.authorization ?? req.headers.Authorization ?? "";
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return false;
  const token = h.slice(7).trim();
  return token === _token;
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => {
      if (!data) return resolve(null);
      try { resolve(JSON.parse(data)); } catch { resolve(null); }
    });
    req.on("error", reject);
  });
}

const sseClients = new Set();

function pushEvent(name, payload) {
  const msg = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const r of [...sseClients]) {
    try { r.write(msg); } catch { sseClients.delete(r); }
  }
}

// ── /balance — proxy to NWC via the same client lumen-client.js uses ──
async function fetchBalance() {
  // Lazy import — keeps mcp/lumen-client.js side-effect-free if we ever
  // want to run the control plane without it.
  const mod = await import("./lumen-client.js");
  try { return await mod.balance(); }
  catch (e) { return { mode: process.env.MOCK_MODE === "true" ? "mock" : "real", balance_sats: null, error: e.message }; }
}

// ── /subscriptions — aggregate subs.listAll() + refresh each ──────────
async function aggregateSubscriptions() {
  const all = subs.listAll();
  const out = [];
  for (const [sid, info] of Object.entries(all)) {
    let live = null;
    try {
      const r = await fetch(`${info.seller_url}/api/v1/subscriptions/${sid}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (r.ok) live = await r.json();
    } catch {}
    const balance_sats = live?.balance_sats ?? info.balance_sats ?? 0;
    const per_event_sats = live?.per_event_sats ?? info.per_event_sats ?? 1;
    const events_remaining = per_event_sats > 0 ? Math.floor(balance_sats / per_event_sats) : null;
    out.push({
      subscription_id: sid,
      seller_pubkey: info.seller_pubkey,
      seller_url: info.seller_url,
      service_local_id: info.service_local_id,
      per_event_sats,
      balance_sats,
      events_remaining,
      status: live?.status ?? info.status ?? "unknown",
      last_seen_alert_ms: info.last_seen_alert_ms ?? 0,
    });
  }
  return out;
}

// ── /subscriptions/:id/cancel — proxy to seller ───────────────────────
async function cancelSubscription(sid) {
  const info = subs.lookup(sid);
  if (!info) return { ok: false, status: 404, body: { error: "unknown subscription" } };
  try {
    const r = await fetch(`${info.seller_url}/api/v1/subscriptions/${sid}/cancel`, { method: "POST" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return { ok: false, status: r.status, body: j ?? { error: `seller ${r.status}` } };
    subs.forget(sid);
    return { ok: true, status: 200, body: j };
  } catch (e) {
    return { ok: false, status: 502, body: { error: `seller unreachable: ${e.message}` } };
  }
}

// ── /sellers — proxy to registry ──────────────────────────────────────
async function fetchSellers() {
  try {
    const r = await fetch(`${REGISTRY_URL}/api/v1/sellers`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { ok: false, status: r.status, body: { error: `registry ${r.status}` } };
    return { ok: true, status: 200, body: await r.json() };
  } catch (e) {
    return { ok: false, status: 502, body: { error: `registry unreachable: ${e.message}` } };
  }
}

async function handler(req, res) {
  // CORS (always considered first; preflight skips auth)
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(403);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${_port}`);
  const p = url.pathname;
  const m = req.method;

  if (m === "GET" && p === "/healthz") {
    return send(res, 200, { ok: true, port: _port });
  }

  if (!checkAuth(req)) {
    return send(res, 401, { error: "unauthorized" });
  }

  if (m === "GET" && p === "/session") {
    return send(res, 200, {
      budget: budgetStatus(),
      kill_switch_active: getKillSwitch(),
      subscriptions: subs.listAll(),
      provider_url: process.env.ANDROMEDA_PROVIDER_URL ?? process.env.LUMEN_PROVIDER_URL ?? "http://localhost:3000",
      registry_url: REGISTRY_URL,
      wallet_mode: process.env.MOCK_MODE === "true" ? "mock" : "real",
    });
  }

  if (m === "POST" && p === "/session/budget") {
    const body = await readJson(req);
    if (!body || !Number.isInteger(body.sats) || body.sats <= 0) {
      return send(res, 400, { error: "sats must be a positive integer" });
    }
    const newStatus = setBudget(body.sats);
    pushEvent("budget", newStatus);
    return send(res, 200, { ok: true, new_status: newStatus });
  }

  if (m === "POST" && p === "/session/kill-switch") {
    const body = await readJson(req);
    if (!body || typeof body.active !== "boolean") {
      return send(res, 400, { error: "active must be a boolean" });
    }
    setKillSwitch(body.active);
    pushEvent("kill_switch", { active: body.active });
    return send(res, 200, { ok: true, kill_switch_active: body.active });
  }

  if (m === "GET" && p === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // ── Phase 3-UI: /balance ─────────────────────────────────────────
  if (m === "GET" && p === "/balance") {
    return send(res, 200, await fetchBalance());
  }

  // ── /transactions ────────────────────────────────────────────────
  if (m === "GET" && p === "/transactions") {
    const limit = Math.max(1, Math.min(1000, parseInt(url.searchParams.get("limit") ?? "100", 10)));
    const txs = readTransactions({ limit });
    return send(res, 200, { transactions: txs, count: txs.length, log_path: transactionsLogPath() });
  }

  // ── /subscriptions ──────────────────────────────────────────────
  if (m === "GET" && p === "/subscriptions") {
    const list = await aggregateSubscriptions();
    return send(res, 200, { subscriptions: list, count: list.length });
  }

  // ── /subscriptions/:id/cancel ───────────────────────────────────
  {
    const cancelMatch = m === "POST" && p.match(/^\/subscriptions\/([^/]+)\/cancel$/);
    if (cancelMatch) {
      const sid = decodeURIComponent(cancelMatch[1]);
      const r = await cancelSubscription(sid);
      return send(res, r.ok ? 200 : r.status, r.body);
    }
  }

  // ── /sellers ────────────────────────────────────────────────────
  if (m === "GET" && p === "/sellers") {
    const r = await fetchSellers();
    return send(res, r.ok ? 200 : r.status, r.body);
  }

  send(res, 404, { error: "not found", path: p });
}

export async function startControlPlane() {
  if (_server) return { port: _port, token: _token };
  _token = loadOrMintToken();
  return new Promise((resolve, reject) => {
    _server = http.createServer((req, res) => {
      handler(req, res).catch(e => {
        process.stderr.write(`[control-plane] handler error: ${e.message}\n`);
        try { send(res, 500, { error: "internal" }); } catch {}
      });
    });
    _server.on("error", reject);
    _server.listen(0, "127.0.0.1", () => {
      _port = _server.address().port;
      try { fs.writeFileSync(PORT_FILE, String(_port)); } catch {}
      process.stderr.write(`[control-plane] listening on 127.0.0.1:${_port}\n`);
      resolve({ port: _port, token: _token });
    });
  });
}

export function stopControlPlane() {
  if (_server) { try { _server.close(); } catch {} _server = null; }
  for (const r of [...sseClients]) { try { r.end(); } catch {} }
  sseClients.clear();
}

export function controlPlaneInfo() {
  return { port: _port, token: _token, port_file: PORT_FILE, token_file: TOKEN_FILE };
}
