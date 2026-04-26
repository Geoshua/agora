#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
//  Andromeda (formerly LUMEN) MCP server — PayMyAgent.
//
//  Exposes a set of tools to any MCP host (Claude Desktop, Cursor,
//  Claude Code, etc.) so a human can hand the agent a Lightning wallet
//  + a sat budget and let it spend per task on Andromeda providers.
//
//  All seven legacy `lumen_*` tools are kept registered as DEPRECATED
//  ALIASES that delegate to the canonical `andromeda_*` names. New
//  tools are only registered under `andromeda_*` (search_services,
//  list_sellers, discover_all).
//
//  All paid tools route through lumen-client.js, which honours the
//  budget guardrail (budget.js) and the per-call cap (MAX_PRICE_SATS).
// ─────────────────────────────────────────────────────────────────────

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  callPaidEndpoint, discover, fetchReceipt, balance, health, close,
  PROVIDER, MOCK, MAX_PRICE_SATS,
} from "./lumen-client.js";
import { getStatus as budgetStatus, setBudget } from "./budget.js";
import * as registry from "./registry-client.js";
import { ensureBuyerIdentity, tryBuyerIdentity } from "./identity.js";

// ─── helpers ──────────────────────────────────────────────────────────
const ok = (data) => ({
  content: [{ type: "text", text: JSON.stringify({ ok: true, ...data, budget: budgetStatus() }, null, 2) }],
  structuredContent: { ok: true, ...data, budget: budgetStatus() },
});
const fail = (message, extra = {}) => ({
  content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, budget: budgetStatus(), ...extra }, null, 2) }],
  structuredContent: { ok: false, error: message, budget: budgetStatus(), ...extra },
  isError: true,
});

// ─── server ───────────────────────────────────────────────────────────
const server = new McpServer({ name: "andromeda-paymyagent", version: "0.2.0" });

// Each handler is a plain async fn; we register it under both names.
function registerWithAlias(name, alias, def, handler) {
  // Canonical (andromeda_*).
  server.registerTool(name, def, handler);
  // Legacy (lumen_*) — same handler, deprecated description.
  if (alias) {
    server.registerTool(alias, {
      ...def,
      title: def.title,
      description: `[deprecated alias of ${name} — will be removed in a future release] ${def.description}`,
    }, handler);
  }
}

// ─── andromeda_status (alias: lumen_status) ───────────────────────────
registerWithAlias(
  "andromeda_status",
  "lumen_status",
  {
    title: "Andromeda status",
    description:
      "Returns the connected Andromeda provider URL, wallet mode (mock|real), per-call cap, " +
      "remaining sat budget, registry URL, and the buyer's Andromeda public key. " +
      "Always-free; call this first if unsure of cost or capacity.",
    inputSchema: {},
  },
  async () => {
    let provider_health = null;
    try { provider_health = await health(); } catch (e) { provider_health = { ok: false, error: e.message }; }
    let registry_health = null;
    try { registry_health = await registry.registryHealth(); } catch (e) { registry_health = { ok: false, error: e.message }; }
    const id = tryBuyerIdentity();
    return ok({
      provider_url: PROVIDER,
      registry_url: registry.REGISTRY_URL,
      wallet_mode: MOCK ? "mock" : "real",
      max_price_per_call_sats: MAX_PRICE_SATS,
      buyer_pubkey: id?.pubkey ?? null,
      provider_health,
      registry_health,
    });
  },
);

// ─── andromeda_discover (alias: lumen_discover) ───────────────────────
registerWithAlias(
  "andromeda_discover",
  "lumen_discover",
  {
    title: "Andromeda discover (single provider)",
    description:
      "Lists every paid service the connected Andromeda provider sells (price, p50 latency, request schema). " +
      "Always-free; safe to call before deciding what to buy. " +
      "For a multi-provider catalog, use andromeda_discover_all.",
    inputSchema: {},
  },
  async () => {
    try { return ok({ catalogue: await discover() }); }
    catch (e) { return fail(`discovery failed: ${e.message}`); }
  },
);

// ─── andromeda_balance (alias: lumen_balance) ─────────────────────────
registerWithAlias(
  "andromeda_balance",
  "lumen_balance",
  {
    title: "Andromeda balance",
    description: "Reports the current Lightning wallet balance (via NWC). Free to call.",
    inputSchema: {},
  },
  async () => ok({ wallet: await balance() }),
);

// ─── andromeda_set_budget (alias: lumen_set_budget) ───────────────────
registerWithAlias(
  "andromeda_set_budget",
  "lumen_set_budget",
  {
    title: "Andromeda set budget",
    description:
      "Reset the per-session spending cap (in sats). Resets the 'spent' counter to 0. " +
      "Use this at the start of a task to give the agent an explicit budget; once exceeded, paid tools refuse.",
    inputSchema: {
      sats: z.number().int().positive().describe("Budget cap, in sats (1 sat ≈ 0.067¢ at $67k/btc)"),
    },
  },
  async ({ sats }) => {
    try { return ok({ message: "budget reset", new_status: setBudget(sats) }); }
    catch (e) { return fail(e.message); }
  },
);

// ─── andromeda_verify_listing (alias: lumen_verify_listing) ───────────
registerWithAlias(
  "andromeda_verify_listing",
  "lumen_verify_listing",
  {
    title: "Andromeda — verify listing",
    description:
      "Pays the connected Andromeda provider (typically 240 sat) to verify a place exists on OpenStreetMap. " +
      "Returns real coordinates, the resolved place name, an OSM id, and an HMAC-signed proof. " +
      "Spends real Lightning sats unless MOCK_MODE=true. Use andromeda_status to confirm cost first.",
    inputSchema: {
      listing: z.string().min(2).describe("Place name, e.g. 'Hotel Adlon Berlin', 'Eiffel Tower Paris'"),
      date:    z.string().describe("ISO-8601 date (YYYY-MM-DD) for the listing's intended use"),
      max_age_h: z.number().int().positive().optional().describe("Max acceptable age of cached imagery (hours, default 24)"),
    },
  },
  async ({ listing, date, max_age_h }) => {
    try {
      const r = await callPaidEndpoint("/api/v1/listing-verify", { listing, date, max_age_h: max_age_h ?? 24 });
      return ok({ spent_sats: r.spent_sats, round_trip_ms: r.elapsed_ms, preimage: r.preimage, proof: r.body });
    } catch (e) { return fail(e.message); }
  },
);

// ─── andromeda_file_receipt (alias: lumen_file_receipt) ───────────────
registerWithAlias(
  "andromeda_file_receipt",
  "lumen_file_receipt",
  {
    title: "Andromeda — file receipt",
    description:
      "Pays the connected Andromeda provider (typically 120 sat) to mint a signed delivery receipt for an order. " +
      "Pass the bolt-11 of the original purchase + an order_id; the provider extracts amount/network/payment_hash, " +
      "signs a claims envelope, and stores it for replay.",
    inputSchema: {
      order_id: z.string().min(1),
      invoice:  z.string().min(10).describe("bolt-11 invoice for the original order (lnbc…)"),
      buyer:    z.string().optional(),
      notes:    z.string().optional(),
    },
  },
  async ({ order_id, invoice, buyer, notes }) => {
    try {
      const r = await callPaidEndpoint("/api/v1/order-receipt", { order_id, invoice, buyer, notes });
      return ok({ spent_sats: r.spent_sats, round_trip_ms: r.elapsed_ms, receipt: r.body });
    } catch (e) { return fail(e.message); }
  },
);

// ─── andromeda_fetch_receipt (alias: lumen_fetch_receipt) ─────────────
registerWithAlias(
  "andromeda_fetch_receipt",
  "lumen_fetch_receipt",
  {
    title: "Andromeda — fetch receipt",
    description:
      "Free replayable read of a receipt the agent has already paid to mint. Returns the same signed claims envelope; " +
      "signature must validate against the provider's L402_SECRET.",
    inputSchema: {
      receipt_id: z.string().min(1).describe("The rcpt_… id returned by andromeda_file_receipt"),
    },
  },
  async ({ receipt_id }) => {
    try { return ok({ receipt: await fetchReceipt(receipt_id) }); }
    catch (e) { return fail(e.message); }
  },
);

// ─── andromeda_search_services (NEW — registry-backed) ────────────────
server.registerTool(
  "andromeda_search_services",
  {
    title: "Andromeda — search services across all sellers",
    description:
      "Search the Andromeda registry for services matching a free-text query. " +
      "Optionally filter by max price (sats) and type (verification|monitoring|dataset|compute|audit|other). " +
      "Returns a ranked list of matching services from any registered seller. Free.",
    inputSchema: {
      query: z.string().min(1).describe("Free-text search, e.g. 'github security advisories'"),
      max_price_sats: z.number().int().positive().optional(),
      type: z.string().optional().describe("Filter by service type"),
    },
  },
  async ({ query, max_price_sats, type }) => {
    try {
      const r = await registry.searchServices(query, { max_price_sats, type });
      return ok({ query: r.query, services: r.services, count: r.count });
    } catch (e) { return fail(`search failed: ${e.message}`); }
  },
);

// ─── andromeda_list_sellers (NEW) ─────────────────────────────────────
server.registerTool(
  "andromeda_list_sellers",
  {
    title: "Andromeda — list registered sellers",
    description:
      "Lists every seller registered in the Andromeda registry, with pubkey, name, URL, honor, and last-active timestamp. Free.",
    inputSchema: {
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().nonnegative().optional(),
    },
  },
  async ({ limit, offset }) => {
    try {
      // No native pagination params — pass through the URL.
      const url = new URL(`${registry.REGISTRY_URL}/api/v1/sellers`);
      if (limit !== undefined) url.searchParams.set("limit", String(limit));
      if (offset !== undefined) url.searchParams.set("offset", String(offset));
      const r = await fetch(url);
      if (!r.ok) throw new Error(`registry ${r.status}`);
      const j = await r.json();
      return ok({ sellers: j.sellers, count: j.count });
    } catch (e) { return fail(`list_sellers failed: ${e.message}`); }
  },
);

// ─── andromeda_discover_all (NEW — multi-provider catalog) ────────────
server.registerTool(
  "andromeda_discover_all",
  {
    title: "Andromeda — discover all services across all providers",
    description:
      "Returns the full catalog of services across every registered Andromeda provider, optionally filtered " +
      "by type, tag, or max price. For single-provider discovery use andromeda_discover. Free.",
    inputSchema: {
      type: z.string().optional(),
      tag: z.string().optional(),
      max_price_sats: z.number().int().positive().optional(),
    },
  },
  async ({ type, tag, max_price_sats }) => {
    try {
      const r = await registry.listServices({ type, tag, max_price_sats });
      return ok({ services: r.services, count: r.count });
    } catch (e) { return fail(`discover_all failed: ${e.message}`); }
  },
);

// ─── connect ──────────────────────────────────────────────────────────
async function main() {
  // Fire-and-forget: generate buyer keypair if missing. Don't block startup.
  ensureBuyerIdentity().catch((e) => {
    process.stderr.write(`[andromeda-mcp] identity init failed: ${e.message}\n`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[andromeda-mcp] ready · provider=${PROVIDER} mode=${MOCK ? "mock" : "real"} budget=${budgetStatus().budget_sats} sat\n`);
}

process.on("SIGINT",  () => { close(); process.exit(0); });
process.on("SIGTERM", () => { close(); process.exit(0); });

main().catch((err) => {
  process.stderr.write(`[andromeda-mcp] fatal: ${err.message}\n`);
  process.exit(1);
});
