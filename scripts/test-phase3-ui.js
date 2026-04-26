#!/usr/bin/env node
// Phase 3-UI test gate — dashboard SPA + control-plane proxies.
//
// 1.  Spawn the registry (so /sellers proxy has something to talk to).
// 2.  Spawn the MCP server (mock mode) — its control plane writes
//     ~/.andromeda/control-port + control-token.
// 3.  Hit the 5 new control-plane endpoints:
//       GET  /balance
//       GET  /transactions
//       GET  /subscriptions
//       POST /subscriptions/:id/cancel  (expect 404 for unknown id)
//       GET  /sellers
// 4.  Verify CORS preflight from http://localhost:5173 succeeds AND
//     from http://evil.com fails.
// 5.  Flip the kill-switch via control plane → GET /session reflects it.
// 6.  Build the dashboard SPA (vite build) and confirm dist/index.html.
// 7.  String-match every CP endpoint path in the built bundle.
// 8.  Print PASS · N/N.

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = path.join(os.homedir(), ".andromeda");
const PORT_FILE = path.join(STATE_DIR, "control-port");
const TOKEN_FILE = path.join(STATE_DIR, "control-token");
const TX_FILE = path.join(STATE_DIR, "transactions.log");
const SUBS_FILE = path.join(STATE_DIR, "subscriptions.json");

let pass = 0, total = 0;
const ok = (n) => { pass++; total++; console.log(`  ok · ${n}`); };
const ko = (n) => { total++; console.log(`  FAIL · ${n}`); };

async function waitForFile(file, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    await sleep(200);
  }
  throw new Error(`file not present in ${timeoutMs}ms: ${file}`);
}

async function isUp(healthUrl) {
  try {
    const r = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

async function startService(cmd, args, cwd, name, healthUrl, timeoutMs = 60000) {
  // If something is already serving the health URL, reuse it (the user
  // may have a dev server running). Don't spawn a duplicate.
  if (await isUp(healthUrl)) return null;
  const proc = spawn(cmd, args, { cwd, shell: true, env: { ...process.env, MOCK_MODE: "true" } });
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", () => {});
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isUp(healthUrl)) return proc;
    await sleep(500);
  }
  proc.kill();
  throw new Error(`${name} didn't become reachable at ${healthUrl} in ${timeoutMs}ms`);
}

async function main() {
  console.log("Phase 3-UI test gate (dashboard SPA + control-plane proxies)\n");

  // Reset only the per-process control-plane handshake files so the
  // freshly-spawned MCP rebinds. We deliberately do NOT touch the
  // registry/lumen sqlite files because the user's dev servers on
  // 3000/3030/3100/3200 may still be using them.
  for (const f of [PORT_FILE, TOKEN_FILE]) {
    try { fs.unlinkSync(f); } catch {}
  }
  // .mcp-session.json is local state owned by the MCP we spawn; safe to clear.
  try { fs.unlinkSync(path.join(REPO, ".mcp-session.json")); } catch {}

  let registry, mcpProc;
  try {
    // ── Registry on 3030 (so /sellers proxy has a target) ──────────
    registry = await startService(
      "npx", ["next", "dev", "-p", "3030"],
      path.join(REPO, "registry"), "registry",
      "http://localhost:3030/api/v1/health",
    );
    ok("registry up");

    // ── Spawn the MCP in standalone control-plane mode ─────────────
    // We don't need the StdioClient — we don't call MCP tools here, only
    // the HTTP control plane. Spawn it and wait for the port file.
    mcpProc = spawn("node", [path.join(REPO, "mcp", "server.js")], {
      cwd: path.join(REPO, "mcp"),
      env: {
        ...process.env,
        ANDROMEDA_PROVIDER_URL: "http://localhost:3000",
        ANDROMEDA_REGISTRY_URL: "http://localhost:3030",
        MOCK_MODE: "true",
        MAX_PRICE_SATS: "1000",
        MAX_BUDGET_SATS: "5000",
      },
      // stdio piped — the MCP wants a stdio transport so we must give it
      // one or it'll exit on EOF.
      stdio: ["pipe", "pipe", "pipe"],
    });
    mcpProc.stdout.on("data", () => {});
    mcpProc.stderr.on("data", () => {});

    const portStr = await waitForFile(PORT_FILE);
    const token = await waitForFile(TOKEN_FILE);
    const port = parseInt(portStr, 10);
    if (!Number.isFinite(port) || port <= 0) { ko(`bad port: ${portStr}`); throw new Error("can't continue"); }
    if (token.length !== 64) { ko(`bad token len: ${token.length}`); throw new Error("can't continue"); }
    ok(`control plane up on 127.0.0.1:${port}`);

    const CP = `http://127.0.0.1:${port}`;
    const auth = { authorization: `Bearer ${token}` };

    // ── 1. GET /balance ────────────────────────────────────────────
    const bR = await fetch(`${CP}/balance`, { headers: auth });
    const bJ = await bR.json();
    if (bR.ok && (bJ.mode === "mock" || bJ.mode === "real")) ok(`GET /balance → mode=${bJ.mode}`);
    else ko(`/balance: ${JSON.stringify(bJ).slice(0, 200)}`);

    // ── 2. GET /transactions (empty initially, log file created) ───
    const tR = await fetch(`${CP}/transactions`, { headers: auth });
    const tJ = await tR.json();
    if (tR.ok && Array.isArray(tJ.transactions)) ok(`GET /transactions → array (${tJ.count})`);
    else ko(`/transactions: ${JSON.stringify(tJ).slice(0, 200)}`);
    if (tJ.log_path && fs.existsSync(tJ.log_path)) ok(`transactions log file present`);
    else ko(`log file missing: ${tJ.log_path}`);

    // ── 3. GET /subscriptions ──────────────────────────────────────
    const sR = await fetch(`${CP}/subscriptions`, { headers: auth });
    const sJ = await sR.json();
    if (sR.ok && Array.isArray(sJ.subscriptions)) ok(`GET /subscriptions → array (${sJ.count})`);
    else ko(`/subscriptions: ${JSON.stringify(sJ).slice(0, 200)}`);

    // ── 4. POST /subscriptions/:id/cancel — expect 404 unknown ─────
    const cR = await fetch(`${CP}/subscriptions/sub_does_not_exist/cancel`, {
      method: "POST", headers: auth,
    });
    const cJ = await cR.json();
    if (cR.status === 404 && /unknown/i.test(cJ.error ?? "")) ok(`POST /subscriptions/:id/cancel (unknown) → 404`);
    else ko(`/cancel unknown: status=${cR.status} ${JSON.stringify(cJ).slice(0, 200)}`);

    // ── 5. GET /sellers — proxies to registry ──────────────────────
    const slR = await fetch(`${CP}/sellers`, { headers: auth });
    const slJ = await slR.json();
    if (slR.ok && Array.isArray(slJ.sellers)) ok(`GET /sellers → array (${slJ.count})`);
    else ko(`/sellers: ${JSON.stringify(slJ).slice(0, 200)}`);

    // ── 6. CORS preflight from allowed origin ──────────────────────
    const corsGood = await fetch(`${CP}/balance`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    const aco = corsGood.headers.get("access-control-allow-origin");
    if (corsGood.status === 204 && aco === "http://localhost:5173") ok(`CORS preflight from 5173 → 204`);
    else ko(`CORS 5173: status=${corsGood.status} aco=${aco}`);

    // ── 7. CORS preflight from disallowed origin ───────────────────
    const corsBad = await fetch(`${CP}/balance`, {
      method: "OPTIONS",
      headers: {
        origin: "http://evil.com",
        "access-control-request-method": "GET",
      },
    });
    const acoBad = corsBad.headers.get("access-control-allow-origin");
    if (corsBad.status === 403 && !acoBad) ok(`CORS preflight from evil.com → blocked`);
    else ko(`CORS evil.com: status=${corsBad.status} aco=${acoBad}`);

    // ── 8. Kill-switch toggled via control plane → /session reflects ─
    const ksR = await fetch(`${CP}/session/kill-switch`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    if (ksR.ok) ok(`POST /session/kill-switch active=true → 200`);
    else ko(`kill-switch on: ${ksR.status}`);

    const sessR = await fetch(`${CP}/session`, { headers: auth });
    const sessJ = await sessR.json();
    if (sessR.ok && sessJ.kill_switch_active === true) ok(`GET /session reflects kill_switch_active=true`);
    else ko(`session reflects kill: ${JSON.stringify(sessJ).slice(0, 200)}`);

    // Reset for cleanliness
    await fetch(`${CP}/session/kill-switch`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
  } finally {
    if (mcpProc) { try { mcpProc.kill(); } catch {} }
    if (registry) { try { registry.kill(); } catch {} }
  }

  // ── 9. Build the SPA ─────────────────────────────────────────────
  const buildR = spawnSync("npm", ["run", "build", "--prefix", "dashboard"], {
    cwd: REPO, encoding: "utf8", shell: true,
  });
  if (buildR.status === 0) ok(`vite build exits 0`);
  else { ko(`vite build status=${buildR.status}\n${buildR.stdout}\n${buildR.stderr}`); }

  // ── 10. dist/index.html exists ───────────────────────────────────
  const distIndex = path.join(REPO, "dashboard", "dist", "index.html");
  if (fs.existsSync(distIndex)) ok(`dashboard/dist/index.html present`);
  else ko(`dist/index.html missing`);

  // ── 11. Built JS bundle references the new control-plane endpoints ──
  const distAssets = path.join(REPO, "dashboard", "dist", "assets");
  let bundleSrc = "";
  if (fs.existsSync(distAssets)) {
    for (const f of fs.readdirSync(distAssets)) {
      if (f.endsWith(".js")) bundleSrc += fs.readFileSync(path.join(distAssets, f), "utf8");
    }
  }
  const expected = ["/balance", "/transactions", "/subscriptions", "/sellers", "/session/kill-switch"];
  const missing = expected.filter((p) => !bundleSrc.includes(p));
  if (missing.length === 0) ok(`built bundle references all 5 control-plane paths`);
  else ko(`bundle missing: ${missing.join(", ")}`);

  // ── 12. Tauri build script exits 0 (no cargo → friendly skip) ────
  const tauriR = spawnSync("node",
    [path.join(REPO, "dashboard", "src", "tauri-build-stub.js"), "build"],
    { encoding: "utf8" });
  if (tauriR.status === 0) ok(`dashboard:tauri:build exits 0`);
  else ko(`tauri stub status=${tauriR.status}`);

  console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => { console.error("fatal:", e.stack || e.message); process.exit(1); });
