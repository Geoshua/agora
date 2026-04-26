// One real-Lightning verify call through the MCP, with before/after wallet
// balances and the preimage printed for visibility.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const c = {
  amber: (s) => `\x1b[38;5;214m${s}\x1b[0m`,
  green: (s) => `\x1b[38;5;120m${s}\x1b[0m`,
  red:   (s) => `\x1b[38;5;203m${s}\x1b[0m`,
  cyan:  (s) => `\x1b[38;5;87m${s}\x1b[0m`,
  dim:   (s) => `\x1b[38;5;245m${s}\x1b[0m`,
  bold:  (s) => `\x1b[1m${s}\x1b[0m`,
};

const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(REPO, "mcp", "server.js")],
  env: { ...process.env },
  cwd: path.join(REPO, "mcp"),
});

const client = new Client({ name: "real-tour", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const parse = (r) => r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "{}");
const call = async (n, a = {}) => {
  try { return parse(await client.callTool({ name: n, arguments: a })); }
  catch (e) { return { ok: false, error: `[${n}] ${e.message}` }; }
};

console.log(c.bold(c.amber("⚡ REAL Lightning · 1 verify call · Hotel Adlon Berlin")));

// 0 — confirm we're real on both sides
const st = await call("andromeda_status");
console.log(`\n${c.amber("▌ status")}`);
console.log(`  ${c.dim("provider".padEnd(14))} ${c.cyan(st.provider_url)}`);
console.log(`  ${c.dim("wallet_mode".padEnd(14))} ${st.wallet_mode === "real" ? c.green("REAL ⚡") : c.red(st.wallet_mode)}`);
console.log(`  ${c.dim("provider mode".padEnd(14))} ${st.provider_health?.wallet_mode === "real" ? c.green("REAL ⚡") : c.red(st.provider_health?.wallet_mode ?? "?")}`);
console.log(`  ${c.dim("budget".padEnd(14))} ${c.amber(`${st.budget.spent_sats}/${st.budget.budget_sats}`)}`);

// 1 — wallet balance BEFORE
const bal0 = await call("andromeda_balance");
console.log(`\n${c.amber("▌ balance before")}  ${c.amber(`${bal0.wallet?.balance_sats} sat`)}`);

// 2 — set a small budget so we can't spend more than we want
await call("andromeda_set_budget", { sats: 500 });

// 3 — the actual real-Lightning call
console.log(`\n${c.amber("▌ andromeda_verify_listing(\"Hotel Adlon Berlin\")")}`);
const t0 = Date.now();
const v = await call("andromeda_verify_listing", { listing: "Hotel Adlon Berlin", date: "2026-04-26" });
const t1 = Date.now();

if (!v.ok) {
  console.log(`  ${c.red("error:")} ${v.error}`);
  await client.close();
  process.exit(1);
}

console.log(`  ${c.dim("status".padEnd(14))} ${c.green("PAID + RESOLVED")}`);
console.log(`  ${c.dim("spent".padEnd(14))} ${c.amber(`${v.spent_sats} sat`)}`);
console.log(`  ${c.dim("preimage".padEnd(14))} ${c.green(v.preimage)}`);
console.log(`  ${c.dim("round_trip".padEnd(14))} ${c.cyan(`${t1 - t0} ms`)}`);
console.log(`  ${c.dim("verified".padEnd(14))} ${v.proof?.verified ? c.green("true") : c.red("false")}  ${c.dim(`(conf ${v.proof?.confidence})`)}`);
console.log(`  ${c.dim("resolved_name".padEnd(14))} ${c.cyan(v.proof?.resolved_name?.split(",")[0] ?? "(synth)")}`);
console.log(`  ${c.dim("exif_geo".padEnd(14))} ${c.cyan(JSON.stringify(v.proof?.exif_geo))}`);
console.log(`  ${c.dim("osm_id".padEnd(14))} ${c.dim(v.proof?.osm_id ?? "?")}`);
console.log(`  ${c.dim("geo_source".padEnd(14))} ${c.cyan(v.proof?.geo_source)}`);

// 4 — wallet balance AFTER
const bal1 = await call("andromeda_balance");
console.log(`\n${c.amber("▌ balance after")}   ${c.amber(`${bal1.wallet?.balance_sats} sat`)}  ${c.dim(`Δ = ${(bal1.wallet?.balance_sats ?? 0) - (bal0.wallet?.balance_sats ?? 0)}`)}`);

console.log(`\n${c.green("done — go check Alby Hub for the matching outgoing tx under lumen-buyer + incoming under lumen-provider.")}`);

await client.close();
process.exit(0);
