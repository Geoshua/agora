// ─── End-to-end MCP tour ─────────────────────────────────────────────
// Spawns the MCP server, calls a wide selection of tools, and prints
// what came back. Designed to populate the registry + provider with
// realistic state so the web UI has data to render.

import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
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
  env: {
    ...process.env,
    ANDROMEDA_PROVIDER_URL: "http://localhost:3000",
    ANDROMEDA_REGISTRY_URL: "http://localhost:3030",
    MOCK_MODE: "true",
    MAX_PRICE_SATS: "10000",
    MAX_BUDGET_SATS: "20000",
    L402_SECRET: "dev-secret-not-for-production-change-me-please-1234567890abcdef",
  },
  cwd: path.join(REPO, "mcp"),
});

const client = new Client({ name: "tour", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const parse = (r) => r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "{}");
const call = async (name, args = {}) => {
  try {
    const r = await client.callTool({ name, arguments: args });
    return parse(r);
  } catch (e) {
    return { ok: false, error: `[${name}] ${e.message}` };
  }
};
const head = (s) => console.log(`\n${c.amber("▌ " + s)}`);
const info = (k, v) => console.log(`  ${c.dim(k.padEnd(22))} ${v}`);

// ─── 1. status / discover / list_sellers ─────────────────────────────
head("status + discover");
const st = await call("andromeda_status");
info("provider_url",   c.cyan(st.provider_url));
info("registry_url",   c.cyan(st.registry_url));
info("buyer_pubkey",   c.dim(st.buyer_pubkey));
info("budget",         c.amber(`${st.budget.budget_sats} (spent ${st.budget.spent_sats})`));
const sellers = await call("andromeda_list_sellers");
info("sellers in registry", c.cyan(sellers.sellers?.length ?? 0));
const all = await call("andromeda_discover_all");
info("services advertised", c.cyan(all.services?.length ?? 0));

// ─── 2. recommend ────────────────────────────────────────────────────
head("recommend (orchestrator)");
const rec = await call("andromeda_recommend", { intent: "verify a hotel listing exists where booked", max_results: 5 });
for (const r of rec.results ?? []) {
  info("→", `${c.cyan((r.local_id ?? r.service?.local_id ?? "?").padEnd(22))} score=${c.amber(r.score.toFixed(3))}  ${c.dim(`im=${r.intent_match.toFixed(2)} hn=${r.honor_normalized.toFixed(2)} pf=${r.price_fit.toFixed(2)}`)}`);
}
for (const e of rec.excluded ?? []) info("excluded", `${c.dim(e.service_id)} — ${c.red(e.reason)}`);

// ─── 3. set budget ───────────────────────────────────────────────────
head("set_budget(2000)");
const sb = await call("andromeda_set_budget", { sats: 2000 });
info("after", c.amber(`${sb.new_status.spent_sats}/${sb.new_status.budget_sats}`));

// ─── 4. buy listing-verify x3 ────────────────────────────────────────
head("buy listing-verify × 3");
for (const place of ["Eiffel Tower Paris", "Hotel Adlon Berlin", "Brandenburg Gate"]) {
  const v = await call("andromeda_verify_listing", { listing: place, date: "2026-04-26" });
  if (v.ok) info(place, `${c.green("✓")} ${c.cyan(v.proof?.resolved_name?.split(",")[0] ?? "synthetic")} · ${c.amber(v.spent_sats + " sat")} · ${c.dim(v.round_trip_ms + "ms")}`);
  else      info(place, c.red(v.error));
}

// ─── 5. file receipt ─────────────────────────────────────────────────
head("file_receipt");
const rec1 = await call("andromeda_file_receipt", {
  order_id: "ord_" + Math.random().toString(36).slice(2, 8),
  invoice: "lnbcMOCK1u1f00d",
  buyer: "tour-buyer",
  notes: "tour test",
});
if (rec1.ok) info("receipt_id", c.cyan(rec1.receipt.receipt_id));
else         info("error", c.red(rec1.error));

// fetch it
if (rec1.ok) {
  const f = await call("andromeda_fetch_receipt", { receipt_id: rec1.receipt.receipt_id });
  info("fetched signature", c.dim((f.receipt?.signature ?? "").slice(0, 32) + "…"));
  info("signature stable",  f.receipt?.signature === rec1.receipt.signature ? c.green("yes") : c.red("MISMATCH"));
}

// ─── 6. browse + purchase dataset ────────────────────────────────────
head("dataset");
const ds = await call("andromeda_browse_datasets");
const datasetSvcs = ds.services ?? [];
info("datasets", c.cyan(datasetSvcs.length));
const datasetSvc = datasetSvcs[0];
if (!datasetSvc) { console.log(c.red("  no datasets to purchase")); }
const b = datasetSvc ? await call("andromeda_purchase_dataset", { seller_pubkey: datasetSvc.seller_pubkey, dataset_id: datasetSvc.local_id }) : { ok: false, error: "no dataset" };
if (b.ok) info("noaa-pnw purchase", `${c.green("✓")} ${c.amber(b.spent_sats + " sat")} · ${c.dim(b.bytes_written + "b")} · file=${c.cyan(b.local_file ?? "?")}`);
else      info("noaa-pnw purchase", c.red(b.error));

const ld = await call("andromeda_list_datasets");
info("local datasets", c.cyan(ld.datasets?.length ?? 0));

// ─── 7. subscriptions ────────────────────────────────────────────────
head("subscribe to market-monitor");
const sub = await call("andromeda_subscribe", {
  seller_url: "http://localhost:3100",
  service_local_id: "github-advisory-monitor",
  deposit_sats: 300,
  config: { watched_repos: ["nextjs/next.js"], severity_min: "low" },
});
if (sub.ok) {
  const sid = sub.subscription_id;
  info("subscription_id", c.cyan(sid));
  info("balance_sats",    c.amber(sub.balance_sats));

  // fire two alerts via mock
  await fetch("http://localhost:3100/api/dev/fire-alert", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription_id: sid, kind: "advisory", payload: { ghsa: "GHSA-xx", severity: "high" } }),
  });
  await fetch("http://localhost:3100/api/dev/fire-alert", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription_id: sid, kind: "advisory", payload: { ghsa: "GHSA-yy", severity: "critical" } }),
  });

  const al = await call("andromeda_check_alerts", { subscription_id: sid });
  info("alerts received", c.cyan(al.alerts?.length ?? 0));
  info("balance after",   c.amber(al.balance_sats));

  // top up
  const tu = await call("andromeda_topup_subscription", { subscription_id: sid, sats: 200 });
  info("after topup", c.amber(tu.balance_sats));
} else info("subscribe", c.red(sub.error));

// ─── 8. rate seller ──────────────────────────────────────────────────
head("rate_seller (vision-oracle-3)");
const rateRes = await call("andromeda_rate_seller", { seller_pubkey: "ede1502755a69606c9deb85b73d90f91e864e7ea5476c7fac9cbe5814abb16f3", stars: 5 });
if (rateRes.ok) info("new honor", c.amber(rateRes.honor_after));
else            info("rate", c.red(rateRes.error));

// ─── 9. budget guardrail ─────────────────────────────────────────────
head("budget guardrail (5 more verifies until refused)");
let succeeded = 0, blocked = 0;
for (let i = 0; i < 5; i++) {
  const v = await call("andromeda_verify_listing", { listing: `loop-${i}`, date: "2026-04-26" });
  if (v.ok) succeeded++;
  else if ((v.error ?? "").includes("budget")) blocked++;
}
info(`succeeded`, c.green(succeeded));
info(`blocked`,   c.red(blocked));

// ─── 10. final status ────────────────────────────────────────────────
head("final status");
const final = await call("andromeda_status");
info("budget", c.amber(`${final.budget.spent_sats}/${final.budget.budget_sats} sat (${final.budget.remaining_sats} remaining)`));

await client.close();
process.exit(0);
