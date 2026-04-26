// Thin registry HTTP client used by the MCP server.
// Reads only — no signed writes from the MCP yet.
// (Buyer-side signed actions like rate_seller come in Phase 5.)

const REGISTRY = process.env.ANDROMEDA_REGISTRY_URL ?? "http://localhost:3030";

async function getJson(path) {
  const r = await fetch(`${REGISTRY}${path}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${path} → ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

export async function listSellers() { return getJson("/api/v1/sellers"); }
export async function getSeller(pk) { return getJson(`/api/v1/sellers/${encodeURIComponent(pk)}`); }
export async function listServices(filter = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== null) q.set(k, String(v));
  const path = `/api/v1/services${q.toString() ? `?${q}` : ""}`;
  return getJson(path);
}
export async function searchServices(query, opts = {}) {
  const q = new URLSearchParams({ q: query });
  if (opts.max_price_sats !== undefined) q.set("max_price_sats", String(opts.max_price_sats));
  if (opts.type) q.set("type", opts.type);
  return getJson(`/api/v1/services/search?${q}`);
}
export async function registryHealth() { return getJson("/api/v1/health"); }

export const REGISTRY_URL = REGISTRY;

// ─── seller URL lookup ──────────────────────────────────────────────
export async function sellerUrl(pubkey) {
  const j = await getSeller(pubkey);
  return j.seller?.url ?? null;
}
