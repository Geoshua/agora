// Andromeda — central constants. Defaults are intentionally
// conservative; every component can override via env vars.

export const DEFAULTS = {
  /** Default budget cap if MAX_BUDGET_SATS is unset. */
  MAX_BUDGET_SATS: 5000,
  /** Default per-call cap if MAX_PRICE_SATS is unset. */
  MAX_PRICE_SATS: 4000,
  /** Default L402 invoice TTL. */
  INVOICE_TTL_SECONDS: 300,
  /** Signed-request clock-skew tolerance (ms). */
  SIGNATURE_VALIDITY_MS: 5 * 60 * 1000,
  /** Provider self-registration retry interval. */
  REGISTRY_HEARTBEAT_INTERVAL_MS: 60_000,
  /** Default platform fee on settled transactions (basis points: 200 = 2%). */
  PLATFORM_FEE_BPS: 200,
  /** Default honor decay window (days of inactivity). */
  HONOR_DECAY_DAYS: 90,
  /** Default review platform-cut fraction. */
  REVIEW_PLATFORM_CUT_FRACTION: 0.05,
  /** How long a reviewer has to submit. */
  REVIEW_DEADLINE_HOURS: 72,
} as const;

export const DEFAULT_REGISTRY_URL = "http://localhost:3030";
export const DEFAULT_PROVIDER_URL = "http://localhost:3000";
