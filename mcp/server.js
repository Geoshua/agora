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
import * as subs from "./subscriptions.js";
import { ensureBuyerIdentity, tryBuyerIdentity } from "./identity.js";
import { startControlPlane, stopControlPlane } from "./control-plane.js";

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

// ─── andromeda_subscribe (NEW — Phase 2) ──────────────────────────────
server.registerTool(
  "andromeda_subscribe",
  {
    title: "Andromeda — subscribe to a sat-per-event service",
    description:
      "Open a prepaid subscription with a seller (e.g. market-monitor's github-advisory-monitor). " +
      "Pay a deposit upfront; each delivered alert debits per_event_sats from balance. " +
      "Returns a subscription_id you'll use for check_alerts / topup / cancel. " +
      "Use andromeda_search_services with type='monitoring' to find subscribable sellers.",
    inputSchema: {
      seller_pubkey: z.string().min(1).describe("Seller's Ed25519 pubkey (hex), from andromeda_list_sellers"),
      service_local_id: z.string().min(1).describe("Local service id at the seller (e.g. 'github-advisory-monitor')"),
      deposit_sats: z.number().int().positive().describe("Initial sats to deposit"),
      per_event_sats: z.number().int().positive().optional().describe("Sats charged per delivered event (default seller's)"),
      config: z.record(z.string(), z.any()).optional().describe("Service-specific config, e.g. { watched_repos: [...], severity_min: 'high' }"),
    },
  },
  async ({ seller_pubkey, service_local_id, deposit_sats, per_event_sats, config }) => {
    try {
      const id = await ensureBuyerIdentity();
      const sellerUrl = await registry.sellerUrl(seller_pubkey);
      if (!sellerUrl) return fail(`unknown seller: ${seller_pubkey}`);
      const r = await fetch(`${sellerUrl}/api/v1/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscriber_pubkey: id.pubkey,
          service_local_id,
          deposit_sats,
          per_event_sats,
          config: config ?? {},
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) return fail(`subscribe failed: ${j.error ?? r.status}`);
      subs.remember(j.subscription_id, {
        seller_pubkey, seller_url: sellerUrl, service_local_id,
        per_event_sats: j.per_event_sats, balance_sats: j.balance_sats,
      });
      return ok({
        subscription_id: j.subscription_id,
        seller_pubkey, seller_url: sellerUrl, service_local_id,
        per_event_sats: j.per_event_sats, balance_sats: j.balance_sats,
        status: j.status,
      });
    } catch (e) { return fail(`subscribe error: ${e.message}`); }
  },
);

// ─── andromeda_list_subscriptions (NEW) ───────────────────────────────
server.registerTool(
  "andromeda_list_subscriptions",
  {
    title: "Andromeda — list subscriptions",
    description: "Lists active subscriptions tracked by this MCP session (cached locally). Free.",
    inputSchema: {},
  },
  async () => {
    try {
      const all = subs.listAll();
      const list = await Promise.all(Object.entries(all).map(async ([sid, info]) => {
        // Refresh balance from seller.
        try {
          const r = await fetch(`${info.seller_url}/api/v1/subscriptions/${sid}`);
          if (r.ok) {
            const j = await r.json();
            return { ...info, subscription_id: sid, balance_sats: j.balance_sats, status: j.status };
          }
        } catch {}
        return { ...info, subscription_id: sid };
      }));
      return ok({ subscriptions: list, count: list.length });
    } catch (e) { return fail(`list_subscriptions failed: ${e.message}`); }
  },
);

// ─── andromeda_check_alerts (NEW) ─────────────────────────────────────
server.registerTool(
  "andromeda_check_alerts",
  {
    title: "Andromeda — poll subscription alerts",
    description:
      "Fetches new alerts for a subscription since the last poll. Updates the local 'last_seen_alert_ms' watermark so subsequent calls are incremental. Free.",
    inputSchema: {
      subscription_id: z.string().min(1),
      since_ms: z.number().int().nonnegative().optional().describe("Override watermark (default: last seen)"),
    },
  },
  async ({ subscription_id, since_ms }) => {
    try {
      const info = subs.lookup(subscription_id);
      if (!info) return fail(`unknown subscription_id: ${subscription_id}`);
      const since = since_ms ?? info.last_seen_alert_ms ?? 0;
      const r = await fetch(`${info.seller_url}/api/v1/subscriptions/${subscription_id}/alerts?since=${since}`);
      const j = await r.json();
      if (!r.ok) return fail(`check_alerts: ${j.error ?? r.status}`);
      // Bump watermark
      const newest = j.alerts.length ? j.alerts[j.alerts.length - 1].created_at_ms : since;
      subs.bumpSinceMs(subscription_id, newest);
      return ok({ subscription_id, since, alerts: j.alerts, count: j.count });
    } catch (e) { return fail(`check_alerts failed: ${e.message}`); }
  },
);

// ─── andromeda_topup_subscription (NEW) ───────────────────────────────
server.registerTool(
  "andromeda_topup_subscription",
  {
    title: "Andromeda — top up a subscription",
    description:
      "Add sats to a subscription's balance. In mock mode, no actual payment moves; in real mode the seller will issue an L402 challenge.",
    inputSchema: {
      subscription_id: z.string().min(1),
      sats: z.number().int().positive(),
    },
  },
  async ({ subscription_id, sats }) => {
    try {
      const info = subs.lookup(subscription_id);
      if (!info) return fail(`unknown subscription_id: ${subscription_id}`);
      const r = await fetch(`${info.seller_url}/api/v1/subscriptions/${subscription_id}/topup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sats }),
      });
      const j = await r.json();
      if (!r.ok) return fail(`topup: ${j.error ?? r.status}`);
      subs.remember(subscription_id, { balance_sats: j.balance_sats });
      return ok({ subscription_id, balance_sats: j.balance_sats, status: j.status });
    } catch (e) { return fail(`topup failed: ${e.message}`); }
  },
);

// ─── andromeda_cancel_subscription (NEW) ──────────────────────────────
server.registerTool(
  "andromeda_cancel_subscription",
  {
    title: "Andromeda — cancel a subscription",
    description: "Cancel an active subscription. In mock mode the unused balance is returned to the buyer's session counter.",
    inputSchema: { subscription_id: z.string().min(1) },
  },
  async ({ subscription_id }) => {
    try {
      const info = subs.lookup(subscription_id);
      if (!info) return fail(`unknown subscription_id: ${subscription_id}`);
      const r = await fetch(`${info.seller_url}/api/v1/subscriptions/${subscription_id}/cancel`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) return fail(`cancel: ${j.error ?? r.status}`);
      subs.forget(subscription_id);
      return ok({ subscription_id, refunded_sats: j.refunded_sats, status: j.status });
    } catch (e) { return fail(`cancel failed: ${e.message}`); }
  },
);

// ─── andromeda_recommend (NEW — Phase 4 orchestrator) ───────────────
server.registerTool(
  "andromeda_recommend",
  {
    title: "Andromeda — orchestrator recommends services for an intent",
    description:
      "Given a free-text intent (e.g. 'watch for security problems in the code we ship'), " +
      "the orchestrator ranks every registered Andromeda service by intent match (60%), " +
      "honor (20%), and price fit (20%). Returns ranked results with explainable per-factor scores. " +
      "Optionally filter by max_price_sats, min_honor, or type. Free.",
    inputSchema: {
      intent: z.string().min(2).describe("Free-text description of what you want done"),
      max_price_sats: z.number().int().positive().optional(),
      min_honor: z.number().nonnegative().optional(),
      type: z.string().optional(),
    },
  },
  async ({ intent, max_price_sats, min_honor, type }) => {
    try {
      const r = await registry.recommend({ intent, max_price_sats, min_honor, type });
      return ok({
        intent: r.intent,
        filter: r.filter,
        weights: r.weights,
        results: r.results,
        excluded: r.excluded,
      });
    } catch (e) { return fail(`recommend failed: ${e.message}`); }
  },
);

// ─── Phase 5 — honor & peer review tools ─────────────────────────────

server.registerTool(
  "andromeda_rate_seller",
  {
    title: "Andromeda — rate a seller (1..5)",
    description:
      "Submit a 1-5 star rating for a seller you've recently transacted with (within 30 days). " +
      "Buyer-signed; the registry verifies the buyer's signature against transactions in its ledger.",
    inputSchema: {
      seller_pubkey: z.string().min(1),
      stars: z.number().int().min(1).max(5),
    },
  },
  async ({ seller_pubkey, stars }) => {
    try {
      const id = await ensureBuyerIdentity();
      const r = await registry.signedPost(`/api/v1/sellers/${encodeURIComponent(seller_pubkey)}/rate`, { stars }, id);
      if (!r.ok) return fail(`rate failed: ${r.json?.error ?? r.status}`);
      return ok({ seller_pubkey, stars, new_honor: r.json.new_honor });
    } catch (e) { return fail(e.message); }
  },
);

server.registerTool(
  "andromeda_request_review",
  {
    title: "Andromeda — request peer review of a service (seller-side)",
    description:
      "Open a peer-review request. Pays an escrow (held by the registry); registry blindly assigns a random reviewer. " +
      "On honest review submission, the reviewer gets escrow minus 5% platform cut. On dispute, the reviewer is slashed " +
      "and escrow returns to the requester. " +
      "This is a SELLER-side tool; the buyer-side identity in this MCP can also test it for development purposes.",
    inputSchema: {
      service_id: z.string().optional(),
      escrow_sats: z.number().int().positive(),
    },
  },
  async ({ service_id, escrow_sats }) => {
    try {
      const id = await ensureBuyerIdentity();
      const r = await registry.signedPost(`/api/v1/reviews/request`, { service_id, escrow_sats }, id);
      if (!r.ok) return fail(`request_review failed: ${r.json?.error ?? r.status}`);
      return ok(r.json);
    } catch (e) { return fail(e.message); }
  },
);

server.registerTool(
  "andromeda_set_reviewer_availability",
  {
    title: "Andromeda — flip reviewer availability",
    description:
      "Mark the buyer/reviewer (this MCP's identity) as available or unavailable for blind review assignment. " +
      "When available, the registry may pick this pubkey for future review requests.",
    inputSchema: { available: z.boolean() },
  },
  async ({ available }) => {
    try {
      const id = await ensureBuyerIdentity();
      const r = await registry.signedPost(`/api/v1/reviewers/availability`, { available }, id);
      if (!r.ok) return fail(`set_availability: ${r.json?.error ?? r.status}`);
      return ok(r.json);
    } catch (e) { return fail(e.message); }
  },
);

server.registerTool(
  "andromeda_check_review_assignments",
  {
    title: "Andromeda — list pending review assignments",
    description: "Returns review requests assigned to this MCP's identity that are still pending submission.",
    inputSchema: {},
  },
  async () => {
    try {
      const id = await ensureBuyerIdentity();
      const j = await registry.getReviewerAssignments(id.pubkey);
      return ok({ reviewer_pubkey: id.pubkey, assigned: j.assigned });
    } catch (e) { return fail(e.message); }
  },
);

server.registerTool(
  "andromeda_submit_review",
  {
    title: "Andromeda — submit a peer review",
    description:
      "Submit a rubric-scored review for a request you were assigned. Scores are 0..5 across six fields. " +
      "Objective fields (correctness, latency, uptime, spec_compliance) require justification (≥5 chars). " +
      "Submission triggers honor update and escrow split.",
    inputSchema: {
      request_id: z.string().min(1),
      scores: z.object({
        correctness: z.number().min(0).max(5),
        latency: z.number().min(0).max(5),
        uptime: z.number().min(0).max(5),
        spec_compliance: z.number().min(0).max(5),
        value_for_price: z.number().min(0).max(5),
        documentation: z.number().min(0).max(5),
      }),
      justifications: z.record(z.string(), z.string()).optional(),
    },
  },
  async ({ request_id, scores, justifications }) => {
    try {
      const id = await ensureBuyerIdentity();
      const r = await registry.signedPost(`/api/v1/reviews/${encodeURIComponent(request_id)}/submit`,
        { scores, justifications: justifications ?? {} }, id);
      if (!r.ok) return fail(`submit: ${r.json?.error ?? r.status}`);
      return ok(r.json);
    } catch (e) { return fail(e.message); }
  },
);

// ─── Phase 6 — dataset tools ──────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATASETS_DIR = path.join(os.homedir(), ".andromeda", "datasets");

server.registerTool(
  "andromeda_browse_datasets",
  {
    title: "Andromeda — browse datasets",
    description:
      "Lists all type=dataset services across registered Andromeda sellers, with provenance, " +
      "row count, size, and a free preview endpoint. Free.",
    inputSchema: {},
  },
  async () => {
    try {
      const r = await registry.listServices({ type: "dataset" });
      return ok({ services: r.services, count: r.count });
    } catch (e) { return fail(`browse_datasets failed: ${e.message}`); }
  },
);

server.registerTool(
  "andromeda_purchase_dataset",
  {
    title: "Andromeda — purchase a dataset",
    description:
      "Pays the L402 paywall for a dataset, downloads it via the signed URL the seller returns, " +
      "and writes it to ~/.andromeda/datasets/<dataset_id>. Spends sats unless MOCK_MODE=true.",
    inputSchema: {
      seller_pubkey: z.string().min(1),
      dataset_id: z.string().min(1),
      save_path: z.string().optional().describe("Override save location"),
    },
  },
  async ({ seller_pubkey, dataset_id, save_path }) => {
    try {
      const sellerUrl = await registry.sellerUrl(seller_pubkey);
      if (!sellerUrl) return fail(`unknown seller: ${seller_pubkey}`);
      // Use callPaidEndpoint? It targets PROVIDER, not the seller URL.
      // We need a one-off paid call to a different host. Inline implement.
      const purchasePath = `/api/v1/dataset/${encodeURIComponent(dataset_id)}/purchase`;
      const id = tryBuyerIdentity();
      const buyerHeader = id ? { "x-andromeda-pubkey": id.pubkey } : {};

      const r = await fetch(`${sellerUrl}${purchasePath}`, {
        method: "POST", headers: { "content-type": "application/json", ...buyerHeader },
        body: JSON.stringify({}),
      });
      if (r.status !== 402) return fail(`expected 402, got ${r.status}`);
      const challenge = await r.json();
      if (challenge.amount_sats > MAX_PRICE_SATS) {
        return fail(`refused: invoice ${challenge.amount_sats} > MAX_PRICE_SATS ${MAX_PRICE_SATS}`);
      }
      const reason = (await import("./budget.js")).reserve(challenge.amount_sats);
      if (reason) return fail(`refused: ${reason}`);

      // Pay (mock or real). For mock: just compute the preimage from the
      // local store IF it's the provider's URL; but here it's the seller's
      // own URL. Mock mode in dataset-seller stores invoices in-memory and
      // doesn't expose /api/dev/pay — but it accepts ANY preimage that
      // hashes to payment_hash. So we'd need a way to retrieve it.
      // Workaround: dataset-seller's mock invoices use deterministic
      // preimages via the macaroon's payment_hash. Look up the invoice
      // map exposed as /api/dev/pay-by-hash on the seller in mock mode.
      let preimage;
      if (MOCK) {
        // Try seller's local mock pay endpoint; fall back to error.
        const payR = await fetch(`${sellerUrl}/api/dev/pay`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ payment_hash: challenge.payment_hash }),
        });
        if (payR.ok) {
          preimage = (await payR.json()).preimage;
        } else {
          return fail(`mock pay not exposed by seller (${sellerUrl}). Seller must implement /api/dev/pay.`);
        }
      } else {
        return fail(`real-mode dataset payment not implemented in MCP yet (NWC route)`);
      }
      (await import("./budget.js")).confirm(challenge.amount_sats);

      // Replay
      const r2 = await fetch(`${sellerUrl}${purchasePath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `L402 ${challenge.macaroon}:${preimage}`,
          ...buyerHeader,
        },
        body: JSON.stringify({}),
      });
      const j2 = await r2.json();
      if (!r2.ok || !j2.ok) return fail(`purchase replay: ${JSON.stringify(j2).slice(0, 200)}`);

      // Download
      const dlR = await fetch(j2.signed_url);
      if (!dlR.ok) return fail(`download failed: ${dlR.status}`);
      const data = await dlR.text();

      // Save
      try { fs.mkdirSync(DATASETS_DIR, { recursive: true, mode: 0o700 }); } catch {}
      const savePath = save_path ?? path.join(DATASETS_DIR, `${dataset_id}.json`);
      fs.writeFileSync(savePath, data);

      return ok({
        dataset_id, seller_pubkey, save_path: savePath,
        bytes_written: Buffer.byteLength(data),
        spent_sats: j2.amount_sats_paid,
        platform_fee_sats: j2.platform_fee_sats,
      });
    } catch (e) { return fail(`purchase_dataset failed: ${e.message}`); }
  },
);

server.registerTool(
  "andromeda_list_datasets",
  {
    title: "Andromeda — list locally-saved datasets",
    description: "Lists files under ~/.andromeda/datasets/. Free.",
    inputSchema: {},
  },
  async () => {
    try {
      let entries = [];
      try {
        entries = fs.readdirSync(DATASETS_DIR).map(name => {
          const fp = path.join(DATASETS_DIR, name);
          const st = fs.statSync(fp);
          return { name, path: fp, size_bytes: st.size, modified: st.mtime.toISOString() };
        });
      } catch {}
      return ok({ datasets_dir: DATASETS_DIR, datasets: entries, count: entries.length });
    } catch (e) { return fail(e.message); }
  },
);

// ─── connect ──────────────────────────────────────────────────────────
async function main() {
  // Generate buyer keypair if missing. We await this so paid tools
  // can attach the X-Andromeda-Pubkey header (lets the registry
  // attribute transactions to a buyer for the rate path).
  try { await ensureBuyerIdentity(); }
  catch (e) {
    process.stderr.write(`[andromeda-mcp] identity init failed: ${e.message}\n`);
  }

  // Start the localhost control plane unless explicitly disabled.
  // Tests / CI can pass ANDROMEDA_CONTROL_PLANE=off to skip.
  if (process.env.ANDROMEDA_CONTROL_PLANE !== "off") {
    try { await startControlPlane(); }
    catch (e) { process.stderr.write(`[andromeda-mcp] control-plane failed: ${e.message}\n`); }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[andromeda-mcp] ready · provider=${PROVIDER} mode=${MOCK ? "mock" : "real"} budget=${budgetStatus().budget_sats} sat\n`);
}

process.on("SIGINT",  () => { stopControlPlane(); close(); process.exit(0); });
process.on("SIGTERM", () => { stopControlPlane(); close(); process.exit(0); });

main().catch((err) => {
  process.stderr.write(`[andromeda-mcp] fatal: ${err.message}\n`);
  process.exit(1);
});
