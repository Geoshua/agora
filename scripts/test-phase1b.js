#!/usr/bin/env node
// ─── Phase 1 (Agora multi-seller) test gate ────────────────────────────
//
// Spins up the registry + the existing provider, verifies that:
//   1. registry boots
//   2. provider self-registers with valid Ed25519 sig
//   3. registry lists the seller and their services
//   4. /v1/services and /v1/services/search return expected shapes
//   5. tampered signature is rejected by the registry (canonical
//      X-Agora-* AND legacy X-Andromeda-* families both 401)
//   6. MCP exposes lumen_* (deprecated) AND andromeda_* (deprecated)
//      AND agora_* (canonical) tool names
//   7. MCP's agora_search_services and agora_list_sellers reach
//      the registry (and so do their andromeda_* aliases)
//   8. After a paid call through the MCP, a transaction appears in
//      seller stats
//
// Exits 0 on PASS · X/Y, non-zero otherwise.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync } from "node:fs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REG = "http://localhost:3030";
const PROV = "http://localhost:3000";

let pass = 0, total = 0;
const ok = (n) => { pass++; total++; console.log(`  ok · ${n}`); };
const ko = (n) => { total++; console.log(`  FAIL · ${n}`); };

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
  // Reset registry + provider state to start fresh.
  for (const file of ["registry.db", "registry.db-wal", "registry.db-shm",
                      "lumen.db", "lumen.db-wal", "lumen.db-shm",
                      ".mcp-session.json"]) {
    const p = path.join(REPO, file);
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }

  console.log("Phase 1 test gate (Agora multi-seller)\n");

  let registry, provider;
  try {
    console.log("  · starting registry on :3030 ...");
    registry = await startService("npx", ["next", "dev", "-p", "3030"], path.join(REPO, "registry"),
                                  "registry", `${REG}/api/v1/health`);
    ok("registry up");

    console.log("  · starting provider on :3000 ...");
    provider = await startService("npx", ["next", "dev", "-p", "3000"], path.join(REPO, "provider"),
                                  "provider", `${PROV}/api/health`);
    ok("provider up");

    // Trigger provider boot to self-register (already done by health check in startService).
    // Wait a few seconds for the async self-register to complete.
    await sleep(3000);

    // ── 1. seller appears in registry
    const sellersR = await fetch(`${REG}/api/v1/sellers`);
    const sellers = await sellersR.json();
    if (sellers.sellers && sellers.sellers.length >= 1) ok(`registry lists ${sellers.sellers.length} seller(s)`);
    else ko(`expected ≥1 seller, got ${JSON.stringify(sellers).slice(0, 200)}`);
    const provider_pubkey = sellers.sellers?.[0]?.pubkey;

    // ── 2. services list
    const svcR = await fetch(`${REG}/api/v1/services`);
    const svc = await svcR.json();
    if (svc.services && svc.services.length >= 2) ok(`registry lists ${svc.services.length} services`);
    else ko(`expected ≥2 services, got ${svc.count}`);

    // ── 3. search by query
    const sr = await fetch(`${REG}/api/v1/services/search?q=verification`);
    const sj = await sr.json();
    if (sj.count >= 1) ok(`search 'verification' → ${sj.count} hit(s)`);
    else ko(`search returned 0 hits`);

    // ── 4. price filter
    const pr = await fetch(`${REG}/api/v1/services?max_price_sats=200`);
    const pj = await pr.json();
    if (pj.services.every(s => s.price_sats <= 200)) ok(`price filter: all services ≤200 sat`);
    else ko(`price filter: got higher-priced services`);

    // ── 5. tampered signature rejected — both canonical AGORA + legacy ANDROMEDA family
    const tamperBody = JSON.stringify({ pubkey: "deadbeef".repeat(8), name: "evil", url: "http://evil" });
    const tamperR = await fetch(`${REG}/api/v1/sellers/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agora-pubkey": "deadbeef".repeat(8),
        "x-agora-timestamp": String(Date.now()),
        "x-agora-sig": "00".repeat(64),
      },
      body: tamperBody,
    });
    if (tamperR.status === 401) ok(`registry rejects tampered X-Agora-* signature (${tamperR.status})`);
    else ko(`expected 401 with X-Agora-* tamper, got ${tamperR.status}`);

    const tamperLegacyR = await fetch(`${REG}/api/v1/sellers/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-andromeda-pubkey": "deadbeef".repeat(8),
        "x-andromeda-timestamp": String(Date.now()),
        "x-andromeda-sig": "00".repeat(64),
      },
      body: tamperBody,
    });
    if (tamperLegacyR.status === 401) ok(`registry still accepts (and rejects on bad sig) legacy X-Andromeda-* family (${tamperLegacyR.status})`);
    else ko(`expected 401 with X-Andromeda-* tamper, got ${tamperLegacyR.status}`);

    // ── 6. MCP tools — both canonical & alias names present
    console.log("  · starting MCP over stdio ...");
    const mcpTransport = new StdioClientTransport({
      command: "node",
      args: [path.join(REPO, "mcp", "server.js")],
      env: {
        ...process.env,
        // Canonical AGORA_* env vars (ADR 0013).
        AGORA_PROVIDER_URL: PROV,
        AGORA_REGISTRY_URL: REG,
        MOCK_MODE: "true",
        MAX_PRICE_SATS: "1000",
        MAX_BUDGET_SATS: "5000",
      },
      cwd: path.join(REPO, "mcp"),
    });
    const client = new Client({ name: "phase1-probe", version: "0.1.0" }, { capabilities: {} });
    await client.connect(mcpTransport);

    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    const requiredCanonical = [
      "agora_status", "agora_discover", "agora_balance", "agora_set_budget",
      "agora_verify_listing", "agora_file_receipt", "agora_fetch_receipt",
      "agora_search_services", "agora_list_sellers", "agora_discover_all",
    ];
    const requiredAliasesAndromeda = [
      "andromeda_status", "andromeda_discover", "andromeda_balance", "andromeda_set_budget",
      "andromeda_verify_listing", "andromeda_file_receipt", "andromeda_fetch_receipt",
      "andromeda_search_services", "andromeda_list_sellers", "andromeda_discover_all",
    ];
    const requiredAliasesLumen = [
      "lumen_status", "lumen_discover", "lumen_balance", "lumen_set_budget",
      "lumen_verify_listing", "lumen_file_receipt", "lumen_fetch_receipt",
    ];
    const missingCanon = requiredCanonical.filter(n => !names.includes(n));
    const missingAndro = requiredAliasesAndromeda.filter(n => !names.includes(n));
    const missingLumen = requiredAliasesLumen.filter(n => !names.includes(n));
    if (missingCanon.length === 0) ok(`all ${requiredCanonical.length} canonical agora_* tools present`);
    else ko(`missing canonical: ${missingCanon.join(", ")}`);
    if (missingAndro.length === 0) ok(`all ${requiredAliasesAndromeda.length} deprecated andromeda_* aliases present`);
    else ko(`missing andromeda aliases: ${missingAndro.join(", ")}`);
    if (missingLumen.length === 0) ok(`all ${requiredAliasesLumen.length} deprecated lumen_* aliases present`);
    else ko(`missing lumen aliases: ${missingLumen.join(", ")}`);

    // Deprecated description on aliases (lumen_status + andromeda_status both deprecated)
    const lumenStatus = tools.tools.find(t => t.name === "lumen_status");
    if (lumenStatus?.description?.includes("[deprecated alias")) ok(`lumen_status carries deprecated marker`);
    else ko(`lumen_status missing deprecated marker`);
    const andromedaStatus = tools.tools.find(t => t.name === "andromeda_status");
    if (andromedaStatus?.description?.includes("[deprecated alias")) ok(`andromeda_status carries deprecated marker`);
    else ko(`andromeda_status missing deprecated marker`);

    const parse = (res) => res.structuredContent ?? (res.content?.[0]?.text ? JSON.parse(res.content[0].text) : {});

    // ── 7. agora_list_sellers (canonical) reaches registry
    const lsR = parse(await client.callTool({ name: "agora_list_sellers", arguments: {} }));
    if (lsR.ok && lsR.sellers?.length >= 1) ok(`agora_list_sellers → ${lsR.sellers.length} seller(s)`);
    else ko(`list_sellers: ${JSON.stringify(lsR).slice(0, 200)}`);

    // ── 8. agora_search_services reaches registry
    const ssR = parse(await client.callTool({
      name: "agora_search_services",
      arguments: { query: "listing verification", max_price_sats: 500 },
    }));
    if (ssR.ok && ssR.count >= 1) ok(`agora_search_services → ${ssR.count} hit(s)`);
    else ko(`search_services: ${JSON.stringify(ssR).slice(0, 200)}`);

    // ── 9. agora_discover_all (multi-provider catalog)
    const daR = parse(await client.callTool({
      name: "agora_discover_all", arguments: { type: "verification" },
    }));
    if (daR.ok && daR.services?.length >= 1) ok(`agora_discover_all type=verification → ${daR.services.length}`);
    else ko(`discover_all: ${JSON.stringify(daR).slice(0, 200)}`);

    // ── 10. Pay through MCP via canonical agora_verify_listing and check the registry sees the tx
    parse(await client.callTool({ name: "agora_set_budget", arguments: { sats: 1000 } }));
    const vR = parse(await client.callTool({
      name: "agora_verify_listing",
      arguments: { listing: "Eiffel Tower Paris", date: "2026-04-26" },
    }));
    if (vR.ok && vR.spent_sats === 240) ok(`agora_verify_listing paid 240 sat`);
    else ko(`paid call: ${JSON.stringify(vR).slice(0, 200)}`);

    // Wait for fire-and-forget tx record to land
    await sleep(2000);
    const statsR = await fetch(`${REG}/api/v1/sellers/${provider_pubkey}/stats`);
    const stats = await statsR.json();
    if (stats.tx_count >= 1) ok(`registry seller stats: tx_count=${stats.tx_count}, sats_earned=${stats.sats_earned}`);
    else ko(`expected ≥1 tx, got ${JSON.stringify(stats).slice(0, 200)}`);

    // ── 11. lumen_status (rebrand-2 alias) returns same shape as agora_status
    const lsr = parse(await client.callTool({ name: "lumen_status", arguments: {} }));
    if (lsr.ok && lsr.wallet_mode === "mock") ok(`lumen_status alias works`);
    else ko(`lumen_status alias broken`);

    // ── 12. andromeda_status (rebrand-1 alias) returns same shape as agora_status
    const asr = parse(await client.callTool({ name: "andromeda_status", arguments: {} }));
    if (asr.ok && asr.wallet_mode === "mock") ok(`andromeda_status alias works`);
    else ko(`andromeda_status alias broken`);

    await client.close();
  } finally {
    if (provider) provider.kill();
    if (registry) registry.kill();
  }

  console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
}

main().catch(e => {
  console.error("fatal:", e.stack || e.message);
  process.exit(1);
});
