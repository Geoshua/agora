#!/usr/bin/env node
// Phase 3 test gate — headless control plane + kill-switch.
//
// 1. Spawns the MCP server (mock mode, no provider needed).
// 2. Reads ~/.andromeda/control-port + control-token.
// 3. GET /session — returns budget + kill_switch_active=false.
// 4. POST /session/budget {sats: 999} — budget resets.
// 5. POST /session/kill-switch {active: true}.
// 6. Calls a paid MCP tool (mock) → expects refusal with "kill_switch_active".
// 7. Flips kill-switch off, paid tool succeeds.
// 8. dashboard:tauri:build stub exits 0.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = path.join(os.homedir(), ".andromeda");
const PORT_FILE = path.join(STATE_DIR, "control-port");
const TOKEN_FILE = path.join(STATE_DIR, "control-token");

let pass = 0, total = 0;
const ok = n => { pass++; total++; console.log(`  ok · ${n}`); };
const ko = n => { total++; console.log(`  FAIL · ${n}`); };

async function startService(cmd, args, cwd, name, healthUrl, timeoutMs = 60000) {
  const proc = spawn(cmd, args, { cwd, shell: true, env: { ...process.env, MOCK_MODE: "true" } });
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", () => {});
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return proc;
    } catch {}
    await sleep(500);
  }
  proc.kill();
  throw new Error(`${name} didn't become reachable at ${healthUrl} in ${timeoutMs}ms`);
}

async function readUntilExists(file, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    await sleep(200);
  }
  throw new Error(`file not present in ${timeoutMs}ms: ${file}`);
}

async function main() {
  // Reset state
  for (const f of ["registry.db", "registry.db-wal", "registry.db-shm",
                   "lumen.db", "lumen.db-wal", "lumen.db-shm", ".mcp-session.json"]) {
    const p = path.join(REPO, f);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
  // Reset control plane state
  for (const f of [PORT_FILE, TOKEN_FILE, path.join(STATE_DIR, "subscriptions.json")]) {
    try { fs.unlinkSync(f); } catch {}
  }

  console.log("Phase 3 test gate (control plane + kill-switch)\n");

  // We need the provider running so paid calls can land.
  let provider, registry;
  try {
    registry = await startService("npx", ["next", "dev", "-p", "3030"], path.join(REPO, "registry"),
                                  "registry", `http://localhost:3030/api/v1/health`);
    provider = await startService("npx", ["next", "dev", "-p", "3000"], path.join(REPO, "provider"),
                                  "provider", `http://localhost:3000/api/health`);
    ok("provider + registry up");

    await sleep(2000);

    // Spawn MCP — its control plane writes ~/.andromeda/control-port + control-token
    const transport = new StdioClientTransport({
      command: "node",
      args: [path.join(REPO, "mcp", "server.js")],
      env: {
        ...process.env,
        ANDROMEDA_PROVIDER_URL: "http://localhost:3000",
        ANDROMEDA_REGISTRY_URL: "http://localhost:3030",
        MOCK_MODE: "true",
        MAX_PRICE_SATS: "1000",
        MAX_BUDGET_SATS: "5000",
      },
      cwd: path.join(REPO, "mcp"),
    });
    const client = new Client({ name: "phase3-probe", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    // Wait for control plane to write its port + token files
    const portStr = await readUntilExists(PORT_FILE);
    const token = await readUntilExists(TOKEN_FILE);
    const port = parseInt(portStr, 10);
    if (Number.isFinite(port) && port > 0) ok(`control plane port file written (${port})`);
    else { ko(`bad port: ${portStr}`); throw new Error("can't continue"); }
    if (token.length === 64) ok(`control plane token written (32 bytes hex)`);
    else ko(`bad token length: ${token.length}`);

    const CP = `http://127.0.0.1:${port}`;

    // ── 1. /healthz works without auth
    const hzR = await fetch(`${CP}/healthz`);
    if (hzR.ok) ok(`GET /healthz (no auth) → 200`);
    else ko(`/healthz → ${hzR.status}`);

    // ── 2. /session without auth → 401
    const noAuthR = await fetch(`${CP}/session`);
    if (noAuthR.status === 401) ok(`GET /session (no auth) → 401`);
    else ko(`expected 401, got ${noAuthR.status}`);

    // ── 3. /session with auth → budget + kill_switch_active
    const sR = await fetch(`${CP}/session`, { headers: { authorization: `Bearer ${token}` } });
    const session = await sR.json();
    if (sR.ok && session.budget && session.kill_switch_active === false) ok(`GET /session: budget=${session.budget.budget_sats}, kill=false`);
    else ko(`session: ${JSON.stringify(session).slice(0, 200)}`);

    // ── 4. budget reset
    const budR = await fetch(`${CP}/session/budget`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sats: 999 }),
    });
    const budJ = await budR.json();
    if (budR.ok && budJ.ok && budJ.new_status?.budget_sats === 999) ok(`budget reset to 999 via control plane`);
    else ko(`budget reset: ${JSON.stringify(budJ).slice(0, 200)}`);

    // ── 5. flip kill-switch on
    const ksOnR = await fetch(`${CP}/session/kill-switch`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    const ksOnJ = await ksOnR.json();
    if (ksOnR.ok && ksOnJ.kill_switch_active === true) ok(`kill-switch flipped ON`);
    else ko(`kill-switch on: ${JSON.stringify(ksOnJ)}`);

    // ── 6. Paid call refused with kill_switch_active reason
    const parse = (res) => res.structuredContent ?? (res.content?.[0]?.text ? JSON.parse(res.content[0].text) : {});
    const v1 = parse(await client.callTool({
      name: "andromeda_verify_listing",
      arguments: { listing: "Hotel Adlon Berlin", date: "2026-04-26" },
    }));
    if (!v1.ok && (v1.error?.includes("kill_switch_active") || v1.error?.includes("kill"))) {
      ok(`paid call refused with kill_switch_active`);
    } else ko(`paid call after kill: ${JSON.stringify(v1).slice(0, 200)}`);

    // ── 7. flip kill-switch off, paid call succeeds
    await fetch(`${CP}/session/kill-switch`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    const v2 = parse(await client.callTool({
      name: "andromeda_verify_listing",
      arguments: { listing: "Eiffel Tower Paris", date: "2026-04-26" },
    }));
    if (v2.ok && v2.spent_sats === 240) ok(`kill-switch off → paid call works`);
    else ko(`paid call after kill-off: ${JSON.stringify(v2).slice(0, 200)}`);

    // ── 8. Status reflects kill-switch in budget block
    const sR2 = await fetch(`${CP}/session`, { headers: { authorization: `Bearer ${token}` } });
    const session2 = await sR2.json();
    if (session2.kill_switch_active === false) ok(`session.kill_switch_active=false after disable`);
    else ko(`expected false, got ${session2.kill_switch_active}`);

    await client.close();
  } finally {
    if (provider) provider.kill();
    if (registry) registry.kill();
  }

  // ── 9. dashboard tauri-build stub exits 0
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("node", [path.join(REPO, "dashboard", "src", "tauri-build-stub.js")],
                     { encoding: "utf8" });
  if (r.status === 0) ok(`dashboard tauri-build stub exits 0`);
  else ko(`tauri-build-stub: status=${r.status}`);

  console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
}

main().catch(e => { console.error("fatal:", e.stack || e.message); process.exit(1); });
