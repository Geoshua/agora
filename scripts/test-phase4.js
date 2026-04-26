#!/usr/bin/env node
// Phase 4 test gate — orchestrator + recommend.
//
// Spins up registry + provider + market-monitor so 3 services are
// registered. Verifies:
//   1. POST /v1/orchestrator/recommend returns ranked results with
//      per-factor breakdown.
//   2. The intent "watch for security problems in code" puts the
//      GitHub-advisory monitor first.
//   3. max_price_sats=100 excludes pricier services with reason
//      "no service within price".
//   4. Every result has {intent_match, honor_normalized, price_fit, score}.
//   5. The MCP tool andromeda_recommend exposes the same.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    "lumen.db", "lumen.db-wal", "lumen.db-shm",
    "agents/market-monitor/monitor.db", "agents/market-monitor/monitor.db-wal", "agents/market-monitor/monitor.db-shm",
    ".mcp-session.json",
  ]) {
    const p = path.join(REPO, f);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }

  console.log("Phase 4 test gate (orchestrator)\n");

  let registry, provider, monitor;
  try {
    registry = await startService("npx", ["next", "dev", "-p", "3030"], path.join(REPO, "registry"),
                                  "registry", `http://localhost:3030/api/v1/health`);
    provider = await startService("npx", ["next", "dev", "-p", "3000"], path.join(REPO, "provider"),
                                  "provider", `http://localhost:3000/api/health`);
    monitor = await startService("node", ["src/server.js"], path.join(REPO, "agents", "market-monitor"),
                                 "market-monitor", `http://localhost:3100/api/health`);
    ok("registry + provider + market-monitor up");

    await sleep(2000);

    // 1. Verify 3 services in registry
    const r0 = await fetch("http://localhost:3030/api/v1/services");
    const j0 = await r0.json();
    if (j0.count >= 3) ok(`registry sees ${j0.count} services`);
    else { ko(`expected ≥3 services, got ${j0.count}`); throw new Error("not enough services to test"); }

    // 2. Recommend — security intent
    const rR = await fetch("http://localhost:3030/api/v1/orchestrator/recommend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "watch for security problems in the code we ship" }),
    });
    const rJ = await rR.json();
    if (rJ.results?.length >= 1) ok(`recommend returned ${rJ.results.length} results`);
    else { ko(`recommend: ${JSON.stringify(rJ).slice(0, 200)}`); throw new Error("no results"); }

    // Top result should be the github-advisory-monitor
    const top = rJ.results[0];
    if (top?.local_id === "github-advisory-monitor") {
      ok(`top match is github-advisory-monitor (score=${top.score.toFixed(3)})`);
    } else {
      ko(`expected github-advisory-monitor first, got ${top?.local_id} (top 3: ${rJ.results.slice(0,3).map(r => r.local_id).join(", ")})`);
    }

    // 3. Each result has the breakdown
    const allHaveBreakdown = rJ.results.every(r =>
      typeof r.intent_match === "number" &&
      typeof r.honor_normalized === "number" &&
      typeof r.price_fit === "number" &&
      typeof r.score === "number");
    if (allHaveBreakdown) ok(`every result has {intent_match, honor_normalized, price_fit, score}`);
    else ko(`some results missing factor breakdown`);

    // 4. Weights returned
    if (rJ.weights?.intent_match === 0.6 && rJ.weights?.honor_normalized === 0.2 && rJ.weights?.price_fit === 0.2) {
      ok(`weights returned (60/20/20)`);
    } else ko(`weights wrong: ${JSON.stringify(rJ.weights)}`);

    // 5. max_price_sats=100 excludes 240-sat & 120-sat services
    const cR = await fetch("http://localhost:3030/api/v1/orchestrator/recommend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "anything", max_price_sats: 100 }),
    });
    const cJ = await cR.json();
    const hasListingExcluded = cJ.excluded?.some(e => e.service_id?.endsWith(":listing-verify") && e.reason === "no service within price");
    if (hasListingExcluded) ok(`max_price=100 excludes listing-verify with reason 'no service within price'`);
    else ko(`expected listing-verify in excluded with that reason, got: ${JSON.stringify(cJ.excluded).slice(0, 200)}`);
    // All remaining results must be ≤100 sat
    if (cJ.results.every(r => r.price_sats <= 100)) ok(`all results within max_price_sats=100`);
    else ko(`results contain price > 100`);

    // 6. type filter
    const tR = await fetch("http://localhost:3030/api/v1/orchestrator/recommend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "anything", type: "monitoring" }),
    });
    const tJ = await tR.json();
    if (tJ.results.every(r => r.type === "monitoring")) ok(`type=monitoring filter works`);
    else ko(`type filter leaked: ${tJ.results.map(r => r.type).join(",")}`);

    // 7. MCP wrapper
    const transport = new StdioClientTransport({
      command: "node",
      args: [path.join(REPO, "mcp", "server.js")],
      env: {
        ...process.env,
        ANDROMEDA_REGISTRY_URL: "http://localhost:3030",
        ANDROMEDA_PROVIDER_URL: "http://localhost:3000",
        MOCK_MODE: "true",
        MAX_PRICE_SATS: "1000",
        MAX_BUDGET_SATS: "5000",
        ANDROMEDA_CONTROL_PLANE: "off",
      },
      cwd: path.join(REPO, "mcp"),
    });
    const client = new Client({ name: "phase4-probe", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    if (tools.tools.some(t => t.name === "andromeda_recommend")) ok(`MCP tool andromeda_recommend registered`);
    else ko(`andromeda_recommend missing`);

    const parse = (res) => res.structuredContent ?? (res.content?.[0]?.text ? JSON.parse(res.content[0].text) : {});
    const mr = parse(await client.callTool({
      name: "andromeda_recommend",
      arguments: { intent: "watch for security advisories" },
    }));
    if (mr.ok && mr.results?.length >= 1) ok(`andromeda_recommend MCP call returns ${mr.results.length} results`);
    else ko(`MCP recommend: ${JSON.stringify(mr).slice(0, 200)}`);

    await client.close();
  } finally {
    if (monitor) monitor.kill();
    if (provider) provider.kill();
    if (registry) registry.kill();
  }

  console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
}

main().catch(e => { console.error("fatal:", e.stack || e.message); process.exit(1); });
