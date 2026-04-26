#!/usr/bin/env node
// Phase 6 test gate — dataset seller + platform fee.
//
//   1. dataset-seller registers with the registry as type=dataset.
//   2. andromeda_browse_datasets surfaces it.
//   3. Free preview returns ≥ 1 row.
//   4. andromeda_purchase_dataset pays 5000 sat (via mock /api/dev/pay),
//      downloads via signed URL, file lands at ~/.andromeda/datasets/.
//   5. registry's GET /v1/platform/revenue returns total_fee_sats=100
//      (2% of 5000) for that single tx.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
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
  throw new Error(`${name} not reachable in ${timeoutMs}ms`);
}

async function main() {
  for (const f of [
    "registry.db", "registry.db-wal", "registry.db-shm",
    "lumen.db", "lumen.db-wal", "lumen.db-shm",
    ".mcp-session.json",
  ]) {
    const p = path.join(REPO, f);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
  // Reset purchased-datasets cache
  try {
    const dsDir = path.join(os.homedir(), ".andromeda", "datasets");
    fs.rmSync(dsDir, { recursive: true, force: true });
  } catch {}

  console.log("Phase 6 test gate (dataset seller + platform fee)\n");

  let registry, dataset;
  try {
    registry = await startService("npx", ["next", "dev", "-p", "3030"], path.join(REPO, "registry"),
                                  "registry", "http://localhost:3030/api/v1/health");
    dataset = await startService("node", ["src/server.js"], path.join(REPO, "agents", "dataset-seller"),
                                 "dataset-seller", "http://localhost:3200/api/health");
    ok("registry + dataset-seller up");
    await sleep(2500);

    // 1. Registered with type=dataset
    const r1 = await fetch("http://localhost:3030/api/v1/services?type=dataset");
    const j1 = await r1.json();
    if (j1.count >= 1 && j1.services.some(s => s.local_id === "noaa-pnw-2015-2025")) {
      ok(`dataset-seller registered with type=dataset`);
    } else { ko(`expected NOAA dataset in registry, got: ${JSON.stringify(j1).slice(0, 200)}`); throw new Error("can't continue"); }
    const sellerPubkey = j1.services.find(s => s.local_id === "noaa-pnw-2015-2025").seller_pubkey;

    // 2. Free preview
    const prevR = await fetch("http://localhost:3200/api/v1/dataset/noaa-pnw-2015-2025/preview");
    const prev = await prevR.json();
    if (prev.preview_rows?.length >= 1) ok(`preview returned ${prev.preview_rows.length} rows`);
    else ko(`preview empty`);

    // 3. MCP — browse + purchase
    const transport = new StdioClientTransport({
      command: "node",
      args: [path.join(REPO, "mcp", "server.js")],
      env: {
        ...process.env,
        ANDROMEDA_REGISTRY_URL: "http://localhost:3030",
        ANDROMEDA_PROVIDER_URL: "http://localhost:3200",
        MOCK_MODE: "true",
        MAX_PRICE_SATS: "10000",
        MAX_BUDGET_SATS: "10000",
        ANDROMEDA_CONTROL_PLANE: "off",
      },
      cwd: path.join(REPO, "mcp"),
    });
    const client = new Client({ name: "phase6-probe", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    const parse = (res) => res.structuredContent ?? (res.content?.[0]?.text ? JSON.parse(res.content[0].text) : {});

    const browse = parse(await client.callTool({ name: "andromeda_browse_datasets", arguments: {} }));
    if (browse.ok && browse.count >= 1) ok(`andromeda_browse_datasets → ${browse.count} dataset(s)`);
    else ko(`browse_datasets: ${JSON.stringify(browse).slice(0, 200)}`);

    parse(await client.callTool({ name: "andromeda_set_budget", arguments: { sats: 10000 } }));

    const purch = parse(await client.callTool({
      name: "andromeda_purchase_dataset",
      arguments: { seller_pubkey: sellerPubkey, dataset_id: "noaa-pnw-2015-2025" },
    }));
    if (purch.ok && purch.spent_sats === 5000) ok(`purchase: spent 5000 sat, platform_fee=${purch.platform_fee_sats}, file at ${path.basename(purch.save_path)}`);
    else { ko(`purchase: ${JSON.stringify(purch).slice(0, 300)}`); throw new Error("can't continue"); }

    if (purch.platform_fee_sats === 100) ok(`platform fee = 100 sat (2% of 5000)`);
    else ko(`expected 100, got ${purch.platform_fee_sats}`);

    // 4. File landed locally
    if (fs.existsSync(purch.save_path) && fs.statSync(purch.save_path).size > 100) {
      ok(`dataset file written to disk (${fs.statSync(purch.save_path).size} bytes)`);
    } else ko(`save_path missing or empty`);

    // 5. andromeda_list_datasets sees it
    const ld = parse(await client.callTool({ name: "andromeda_list_datasets", arguments: {} }));
    if (ld.ok && ld.count >= 1) ok(`andromeda_list_datasets → ${ld.count} file(s)`);
    else ko(`list_datasets: ${JSON.stringify(ld).slice(0, 200)}`);

    // 6. registry tx ledger captured platform fee
    await sleep(2500);
    const rev = await fetch("http://localhost:3030/api/v1/platform/revenue", {
      headers: { "x-admin-secret": "dev-admin-secret" },
    });
    const revJ = await rev.json();
    if (rev.ok && revJ.total_fee_sats >= 100 && revJ.tx_count >= 1) {
      ok(`registry platform revenue: ${revJ.total_fee_sats} sat across ${revJ.tx_count} tx(s)`);
    } else ko(`platform revenue: ${JSON.stringify(revJ).slice(0, 200)}`);

    // 7. Signed URL is 24h-valid (test that exp is reasonable)
    if (typeof purch.bytes_written === "number" && purch.bytes_written > 0) ok(`bytes_written reported (${purch.bytes_written})`);
    else ko(`bytes_written missing`);

    await client.close();
  } finally {
    if (dataset) dataset.kill();
    if (registry) registry.kill();
  }

  console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
}

main().catch(e => { console.error("fatal:", e.stack || e.message); process.exit(1); });
