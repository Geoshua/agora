// Localhost-only HTTP control plane for the MCP server.
//
// Lets a desktop dashboard (or a curl) read session state and flip the
// kill-switch / reset the budget without restarting the MCP. Binds to
// 127.0.0.1 only. Bearer-token auth — token is 32 bytes hex, stored
// 0600 at ~/.andromeda/control-token. Bound port is written to
// ~/.andromeda/control-port.
//
// Endpoints:
//   GET  /session                    — full session snapshot
//   POST /session/budget {sats}      — reset budget cap
//   POST /session/kill-switch {active} — flip kill switch
//   GET  /events                     — server-sent events stream

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { getStatus as budgetStatus, setBudget, getKillSwitch, setKillSwitch } from "./budget.js";
import * as subs from "./subscriptions.js";

const STATE_DIR = process.env.ANDROMEDA_STATE_DIR ?? path.join(os.homedir(), ".andromeda");
const PORT_FILE = path.join(STATE_DIR, "control-port");
const TOKEN_FILE = path.join(STATE_DIR, "control-token");

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

async function handler(req, res) {
  // ALWAYS require auth except for /healthz so a UI can probe.
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
      registry_url: process.env.ANDROMEDA_REGISTRY_URL ?? "http://localhost:3030",
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
