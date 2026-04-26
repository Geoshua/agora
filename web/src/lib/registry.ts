// Typed fetcher for the Andromeda registry's public REST endpoints.
// All functions are server-side. No client API surface here.

export const REGISTRY_URL =
  process.env.ANDROMEDA_REGISTRY_URL ?? "http://localhost:3030";

export type Seller = {
  pubkey: string;
  name: string;
  url: string;
  honor: number;
  description: string;
  registered_at: string; // ISO
  last_active_at: string; // ISO
};

export type Service = {
  id: string;
  seller_pubkey: string;
  local_id: string;
  name: string;
  description: string;
  type: string;
  tags: string[];
  price_sats: number;
  p50_ms: number;
  endpoint: string;
  updated_at: string;
};

export type SellerStats = {
  pubkey: string;
  name: string;
  honor: number;
  tx_count: number;
  sats_earned: number;
};

export type SellerBadges = {
  peer_reviewed: boolean;
  review_count: number;
  max_rollup: number;
};

export type SellerDetail = {
  seller: Seller & { badges: SellerBadges };
  services: (Omit<Service, "seller_pubkey"> & { seller_pubkey?: string })[];
  stats: { tx_count: number; sats_earned: number };
};

export type RecommendResult = {
  service_id: string;
  seller_pubkey: string;
  local_id: string;
  name: string;
  description: string;
  type: string;
  price_sats: number;
  honor: number;
  intent_match: number;
  honor_normalized: number;
  price_fit: number;
  score: number;
  endpoint: string;
};

export type RecommendResponse = {
  intent: string;
  filter: {
    max_price_sats: number | null;
    min_honor: number | null;
    type: string | null;
  };
  weights: { intent_match: number; honor_normalized: number; price_fit: number };
  results: RecommendResult[];
  excluded: Array<{ service_id: string; reason: string }>;
};

// List pages — 60s revalidation is fine for slow-moving catalog data.
const LIST_REVALIDATE = { next: { revalidate: 60 } };
// Detail pages — fresh on every load.
const NO_STORE: RequestInit = { cache: "no-store" };

async function safeJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function listSellers(opts: { limit?: number; offset?: number } = {}): Promise<{
  sellers: Seller[];
  count: number;
} | null> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return safeJson(
    `${REGISTRY_URL}/api/v1/sellers${qs ? `?${qs}` : ""}`,
    LIST_REVALIDATE
  );
}

export async function getSellerDetail(pubkey: string): Promise<SellerDetail | null> {
  return safeJson(`${REGISTRY_URL}/api/v1/sellers/${pubkey}`, NO_STORE);
}

export async function listServices(opts: {
  type?: string;
  tag?: string;
  max_price_sats?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<{ services: Service[]; count: number } | null> {
  const params = new URLSearchParams();
  if (opts.type) params.set("type", opts.type);
  if (opts.tag) params.set("tag", opts.tag);
  if (opts.max_price_sats !== undefined)
    params.set("max_price_sats", String(opts.max_price_sats));
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return safeJson(
    `${REGISTRY_URL}/api/v1/services${qs ? `?${qs}` : ""}`,
    LIST_REVALIDATE
  );
}

export async function searchServices(
  q: string
): Promise<{ query: string; services: Service[]; count: number } | null> {
  return safeJson(
    `${REGISTRY_URL}/api/v1/services/search?q=${encodeURIComponent(q)}`,
    NO_STORE
  );
}

export async function recommend(body: {
  intent: string;
  max_price_sats?: number;
  min_honor?: number;
  type?: string;
}): Promise<RecommendResponse | null> {
  try {
    const r = await fetch(`${REGISTRY_URL}/api/v1/orchestrator/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as RecommendResponse;
  } catch {
    return null;
  }
}

// Find a single service by id. Registry has no GET /services/:id endpoint,
// so we list all and find. This is fine for the demo's catalog scale.
export async function findServiceById(id: string): Promise<Service | null> {
  const all = await listServices({ limit: 500 });
  if (!all) return null;
  return all.services.find((s) => s.id === id) ?? null;
}

// Aggregate counts for the homepage hero. Uses sellerStats per seller,
// summing tx_count and sats_earned. No registry endpoint exposes this
// directly without admin auth (`/platform/revenue` is admin-only).
export async function aggregateStats(): Promise<{
  seller_count: number;
  service_count: number;
  total_tx: number;
  total_sats_moved: number;
} | null> {
  const sellers = await listSellers({ limit: 500 });
  const services = await listServices({ limit: 500 });
  if (!sellers || !services) return null;
  let total_tx = 0;
  let total_sats_moved = 0;
  await Promise.all(
    sellers.sellers.map(async (s) => {
      const stats = await safeJson<SellerStats>(
        `${REGISTRY_URL}/api/v1/sellers/${s.pubkey}/stats`,
        LIST_REVALIDATE
      );
      if (stats) {
        total_tx += stats.tx_count ?? 0;
        total_sats_moved += stats.sats_earned ?? 0;
      }
    })
  );
  return {
    seller_count: sellers.count,
    service_count: services.count,
    total_tx,
    total_sats_moved,
  };
}

// Per-seller stats (for /sellers list rows).
export async function sellerStats(pubkey: string): Promise<SellerStats | null> {
  return safeJson(`${REGISTRY_URL}/api/v1/sellers/${pubkey}/stats`, LIST_REVALIDATE);
}
