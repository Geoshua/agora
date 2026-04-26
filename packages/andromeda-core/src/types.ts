// Andromeda — shared TypeScript types.
//
// These types describe data that crosses service boundaries (registry
// ↔ providers ↔ MCP). Per-service internal types stay private.

export type ServiceType =
  | "verification"
  | "monitoring"
  | "dataset"
  | "compute"
  | "audit"
  | "other";

export type Service = {
  /** Globally-unique service id, format `<seller-pubkey>:<local-id>`. */
  id: string;
  /** Owning seller's Ed25519 pubkey (hex). */
  seller_pubkey: string;
  /** Local id within the seller (e.g. "listing-verify"). */
  local_id: string;
  /** Human-readable name. */
  name: string;
  /** Free-text description; embedded in Phase 4. */
  description: string;
  /** Type taxonomy. */
  type: ServiceType;
  /** Free-text tags for filtering. */
  tags: string[];
  /** Per-call price in sats. */
  price_sats: number;
  /** Median latency in ms (provider self-reported). */
  p50_ms?: number;
  /** Endpoint URL the buyer hits to invoke the service. */
  endpoint: string;
  /** ISO timestamp of last update. */
  updated_at: string;
};

export type Seller = {
  /** Ed25519 pubkey (hex), the canonical id. */
  pubkey: string;
  /** Human-readable display name. */
  name: string;
  /** Base URL where this seller hosts its services. */
  url: string;
  /** Honor score; 0 = new, climbs with reviews + activity. */
  honor: number;
  /** Brief self-description. */
  description?: string;
  /** ISO timestamp of registration. */
  registered_at: string;
  /** ISO timestamp of last activity (used for honor decay). */
  last_active_at: string;
};

export type Transaction = {
  /** Unique tx id (uuid). */
  id: string;
  /** Buyer pubkey (hex). */
  buyer_pubkey: string;
  /** Seller pubkey (hex). */
  seller_pubkey: string;
  /** Service id this tx settled. */
  service_id: string;
  /** Total paid (sats). */
  amount_sats: number;
  /** Platform fee deducted (sats). */
  platform_fee_sats: number;
  /** Lightning payment_hash (hex). */
  payment_hash: string;
  /** ISO timestamp. */
  settled_at: string;
};

export type Subscription = {
  /** Subscription id (uuid). */
  id: string;
  /** Subscriber pubkey. */
  subscriber_pubkey: string;
  /** Provider that issued the subscription. */
  provider_pubkey: string;
  /** Service local-id this subscription is for. */
  service_local_id: string;
  /** Sats per delivered event. */
  per_event_sats: number;
  /** Remaining prepaid balance (sats). */
  balance_sats: number;
  /** ISO timestamp of creation. */
  created_at: string;
  /** Per-service config (e.g. watched_repos, severity_min). */
  config: Record<string, unknown>;
  /** "active" | "cancelled" | "exhausted" */
  status: "active" | "cancelled" | "exhausted";
};

export type Review = {
  id: string;
  /** Subject (seller or service id) being reviewed. */
  subject_pubkey: string;
  /** Author pubkey (the assigned reviewer, blind to others). */
  reviewer_pubkey: string;
  /** Order of review (request id). */
  request_id: string;
  /** ISO timestamp. */
  submitted_at: string;
  /** Per-rubric numeric scores (0..5 unless noted). */
  scores: Record<string, number>;
  /** Free-text justifications keyed by rubric field. */
  justifications: Record<string, string>;
};

export type Macaroon = {
  payment_hash: string;
  resource: string;
  amount: number;
  exp: number;
};
