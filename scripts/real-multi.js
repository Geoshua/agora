// Multi-call real-Lightning tour. Verifies 3 places + files 1 receipt.
// Total: ~840 sat (~$0.56).

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

const client = new Client({ name: "real-multi", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const parse = (r) => r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "{}");
const call = async (n, a = {}) => {
  try { return parse(await client.callTool({ name: n, arguments: a })); }
  catch (e) { return { ok: false, error: `[${n}] ${e.message}` }; }
};

console.log(c.bold(c.amber("⚡ REAL Lightning multi-call · 3 verifies + 1 receipt")));

await call("andromeda_set_budget", { sats: 2000 });

const places = [
  ["Eiffel Tower Paris",         "ord_eif_" + Date.now().toString(36)],
  ["Brandenburger Tor Berlin",   "ord_bra_" + Date.now().toString(36)],
  ["Sydney Opera House",         "ord_syd_" + Date.now().toString(36)],
];

let totalSpent = 0;
let totalMs = 0;
let lastVerifyResult = null;

for (const [place, orderId] of places) {
  const t0 = Date.now();
  const v = await call("andromeda_verify_listing", { listing: place, date: "2026-04-26" });
  const dt = Date.now() - t0;
  totalMs += dt;

  if (!v.ok) {
    console.log(`  ${c.red("✗")} ${place.padEnd(28)} ${c.red(v.error?.slice(0, 80))}`);
    continue;
  }
  totalSpent += v.spent_sats ?? 0;
  console.log(`  ${c.green("✓")} ${place.padEnd(28)}  ${c.amber((v.spent_sats + " sat").padEnd(8))} ${c.cyan(`${dt}ms`.padEnd(7))} ${c.dim(`pre=${v.preimage?.slice(0,8)}…`)}  ${c.cyan(v.proof?.resolved_name?.split(",")[0] ?? "")}`);
  lastVerifyResult = { invoice: v.paid_invoice, orderId };
}

// File a receipt for the last verify
if (lastVerifyResult) {
  const t0 = Date.now();
  const r = await call("andromeda_file_receipt", {
    order_id: lastVerifyResult.orderId,
    invoice:  lastVerifyResult.invoice,
    buyer:    "tripplanner-7",
    notes:    `verified Sydney Opera House on 2026-04-26`,
  });
  const dt = Date.now() - t0;
  totalMs += dt;
  if (r.ok) {
    totalSpent += r.spent_sats ?? 0;
    console.log(`  ${c.green("✓")} ${"receipt for last verify".padEnd(28)}  ${c.amber((r.spent_sats + " sat").padEnd(8))} ${c.cyan(`${dt}ms`.padEnd(7))} ${c.dim(`id=${r.receipt?.receipt_id}`)}`);
  } else {
    console.log(`  ${c.red("✗")} receipt failed: ${r.error}`);
  }
}

console.log(`\n${c.amber("▌ summary")}`);
console.log(`  ${c.dim("total spent".padEnd(14))} ${c.amber(`${totalSpent} sat`)}  ${c.dim(`(≈ $${(totalSpent * 0.00067).toFixed(4)})`)}`);
console.log(`  ${c.dim("round trip".padEnd(14))} ${c.cyan(`${totalMs} ms`)}`);
console.log(`  ${c.dim("calls".padEnd(14))} ${c.cyan("4")}`);

await client.close();
process.exit(0);
