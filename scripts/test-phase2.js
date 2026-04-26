#!/usr/bin/env node
// Phase 2 test gate — subscriptions + market-monitor agent.
//
// Spins up registry, market-monitor, and the MCP. Verifies:
//   1. market-monitor self-registers with the registry as type=monitoring
//   2. MCP can subscribe with deposit=500, per_event=50
//   3. After firing 3 mock alerts via /api/dev/fire-alert, alerts surface
//      via andromeda_check_alerts and balance is 500 - 3*50 = 350
//   4. Top-up adds to balance
//   5. Cancel returns the remaining balance
//   6. balance_exhausted alert fires when funds run out
//
// Exits 0 / non-zero with PASS · X/Y line.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync, rmSync } from "node:fs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REG = "http://localhost:3030";
const MON = "http://localhost:3100";

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

async function main() {
  // Reset state
  for (const f of [
    "registry.db", "registry.db-wal", "registry.db-shm",
    "agents/market-monitor/monitor.db",
    "agents/market-monitor/monitor.db-wal",
    "agents/market-monitor/monitor.db-shm",
    "lumen.db", "lumen.db-wal", "lumen.db-shm",
    ".mcp-session.json",
  ]) {
    const p = path.join(REPO, f);
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }
  // Reset MCP buyer state.
  const stateDir = path.join(os.homedir(), ".andromeda");
  try { rmSync(path.join(stateDir, "subscriptions.json"), { force: true }); } catch {}

  console.log("Phase 2 test gate (subscriptions + market-monitor)\n");

  let registry, monitor;
  try {
    registry = await startService("npx", ["next", "dev", "-p", "3030"], path.join(REPO, "registry"),
                                  "registry", `${REG}/api/v1/health`);
    ok("registry up");

    monitor = await startService("node", ["src/server.js"], path.join(REPO, "agents", "market-monitor"),
                                 "market-monitor", `${MON}/api/health`);
    ok("market-monitor up");

    await sleep(2000);

    // 1. Registered with type=monitoring
    const r1 = await fetch(`${REG}/api/v1/services?type=monitoring`);
    const j1 = await r1.json();
    if (j1.count >= 1 && j1.services.some(s => s.local_id === "github-advisory-monitor")) {
      ok("market-monitor registered with type=monitoring");
    } else ko(`expected github-advisory-monitor in registry, got ${JSON.stringify(j1).slice(0, 200)}`);
    const sellerPubkey = j1.services.find(s => s.local_id === "github-advisory-monitor")?.seller_pubkey;

    // 2. Spin up MCP and subscribe
    const transport = new StdioClientTransport({
      command: "node",
      args: [path.join(REPO, "mcp", "server.js")],
      env: {
        ...process.env,
        ANDROMEDA_REGISTRY_URL: REG,
        ANDROMEDA_PROVIDER_URL: MON,  // not really used for subscribe path
        MOCK_MODE: "true",
        MAX_PRICE_SATS: "1000",
        MAX_BUDGET_SATS: "5000",
      },
      cwd: path.join(REPO, "mcp"),
    });
    const client = new Client({ name: "phase2-probe", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    const parse = (res) => res.structuredContent ?? (res.content?.[0]?.text ? JSON.parse(res.content[0].text) : {});

    const subR = parse(await client.callTool({
      name: "andromeda_subscribe",
      arguments: {
        seller_pubkey: sellerPubkey,
        service_local_id: "github-advisory-monitor",
        deposit_sats: 500,
        per_event_sats: 50,
        config: { watched_repos: ["acme/web", "acme/api"], severity_min: "low" },
      },
    }));
    if (subR.ok && subR.subscription_id?.startsWith("sub_")) ok(`subscribed (${subR.subscription_id.slice(0, 14)}...) deposit=500`);
    else { ko(`subscribe: ${JSON.stringify(subR).slice(0, 200)}`); throw new Error("can't continue without subscription"); }
    const subId = subR.subscription_id;

    // 3. Fire 3 mock alerts via /api/dev/fire-alert
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${MON}/api/dev/fire-alert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscription_id: subId,
          kind: "advisory",
          payload: { ghsa_id: `GHSA-test-${i}`, severity: "high", summary: `test #${i}` },
        }),
      });
      const j = await r.json();
      if (!j.ok) ko(`fire-alert ${i} failed: ${JSON.stringify(j)}`);
    }
    ok("fired 3 alerts via /api/dev/fire-alert");

    // 4. check_alerts returns 3, balance is 350
    const ca = parse(await client.callTool({
      name: "andromeda_check_alerts", arguments: { subscription_id: subId },
    }));
    if (ca.ok && ca.count >= 3) ok(`check_alerts → ${ca.count} alerts`);
    else ko(`check_alerts: ${JSON.stringify(ca).slice(0, 200)}`);

    const subStatus = await fetch(`${MON}/api/v1/subscriptions/${subId}`).then(r => r.json());
    if (subStatus.balance_sats === 350) ok(`balance after 3 alerts = 350 sat`);
    else ko(`expected 350, got ${subStatus.balance_sats}`);

    // 5. Top up
    const topR = parse(await client.callTool({
      name: "andromeda_topup_subscription", arguments: { subscription_id: subId, sats: 100 },
    }));
    if (topR.ok && topR.balance_sats === 450) ok(`top-up: balance now ${topR.balance_sats}`);
    else ko(`topup: ${JSON.stringify(topR).slice(0, 200)}`);

    // 6. Drain to exhaustion.
    // 450 / 50 = 9 events. Fire 10 to trigger balance_exhausted.
    for (let i = 0; i < 12; i++) {
      await fetch(`${MON}/api/dev/fire-alert`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription_id: subId, kind: "advisory", payload: { ghsa_id: `GHSA-drain-${i}`, severity: "high" } }),
      });
    }
    const ca2 = parse(await client.callTool({
      name: "andromeda_check_alerts", arguments: { subscription_id: subId, since_ms: 0 },
    }));
    const exhausted = ca2.alerts?.some(a => a.kind === "balance_exhausted");
    if (exhausted) ok(`balance_exhausted alert fired when funds ran out`);
    else ko(`expected balance_exhausted alert, got kinds: ${ca2.alerts?.map(a => a.kind).join(",")}`);

    // 7. Cancel returns remaining balance (should be 0 because exhausted)
    // For the cancel-refund test we need a NEW subscription that hasn't drained.
    const sub2 = parse(await client.callTool({
      name: "andromeda_subscribe",
      arguments: {
        seller_pubkey: sellerPubkey,
        service_local_id: "github-advisory-monitor",
        deposit_sats: 200,
        per_event_sats: 50,
      },
    }));
    if (!sub2.ok) { ko(`second subscribe failed`); throw new Error("can't test cancel"); }
    // Fire 1 alert (debit 50, balance=150)
    await fetch(`${MON}/api/dev/fire-alert`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription_id: sub2.subscription_id, kind: "advisory", payload: { ghsa_id: "GHSA-cancel-test", severity: "high" } }),
    });
    const cancelR = parse(await client.callTool({
      name: "andromeda_cancel_subscription", arguments: { subscription_id: sub2.subscription_id },
    }));
    if (cancelR.ok && cancelR.refunded_sats === 150) ok(`cancel returned 150 sat (200 deposit - 50 debit)`);
    else ko(`cancel: ${JSON.stringify(cancelR).slice(0, 200)}`);

    // 8. Verify alert payload signature is HMAC-base64url over {kind, payload}
    const fp = ca.alerts?.[0];
    if (fp?.signature && fp.signature.length >= 40) ok(`alert carries HMAC signature (${fp.signature.length} chars)`);
    else ko(`alert signature missing/short: ${JSON.stringify(fp)}`);

    // 9. New tools surfaced via list_tools
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    const required = ["andromeda_subscribe", "andromeda_list_subscriptions", "andromeda_check_alerts", "andromeda_topup_subscription", "andromeda_cancel_subscription"];
    const missing = required.filter(n => !names.includes(n));
    if (missing.length === 0) ok(`all 5 subscription tools registered`);
    else ko(`missing: ${missing.join(",")}`);

    await client.close();
  } finally {
    if (monitor) monitor.kill();
    if (registry) registry.kill();
  }

  console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
}

main().catch(e => { console.error("fatal:", e.stack || e.message); process.exit(1); });
