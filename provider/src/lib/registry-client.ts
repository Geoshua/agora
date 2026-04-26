// Provider → Registry client.
// Self-registers on startup; records each settled tx as fire-and-forget.
// Never throws back into the request path; logs failures and moves on.

import { signRequest } from "@andromeda/core";
import { ensureIdentity, tryIdentity } from "./identity";
import { logger } from "./log";

const REGISTRY_URL =
  process.env.ANDROMEDA_REGISTRY_URL ??
  process.env.LUMEN_REGISTRY_URL ??
  "http://localhost:3030";

const PROVIDER_PUBLIC_URL =
  process.env.ANDROMEDA_PROVIDER_PUBLIC_URL ??
  process.env.PROVIDER_PUBLIC_URL ??
  `http://localhost:${process.env.PORT ?? 3000}`;

const PROVIDER_NAME =
  process.env.ANDROMEDA_PROVIDER_NAME ??
  "vision-oracle-3";

const PROVIDER_DESCRIPTION =
  process.env.ANDROMEDA_PROVIDER_DESCRIPTION ??
  "OSM-geocoded listing verification + signed delivery receipts.";

let _heartbeatInterval: NodeJS.Timeout | null = null;

const SERVICES = [
  {
    local_id: "listing-verify",
    name: "Listing verification (OSM-geocoded)",
    description: "Resolves a place name against OpenStreetMap and returns coordinates, OSM id, confidence, and an HMAC-signed proof. Fast (~1.1s p50). Falls back to a deterministic synthetic when not found.",
    type: "verification",
    tags: ["geo", "verification", "osm", "listing"],
    price_sats: parseInt(process.env.PRICE_SATS ?? "240", 10),
    p50_ms: 1100,
    endpoint: `${PROVIDER_PUBLIC_URL}/api/v1/listing-verify`,
  },
  {
    local_id: "order-receipt",
    name: "Signed delivery receipt",
    description: "Issues a timestamped HMAC-signed receipt for a Lightning-paid order. Pairs with agentic shopping flows.",
    type: "audit",
    tags: ["receipt", "audit", "lightning"],
    price_sats: 120,
    p50_ms: 350,
    endpoint: `${PROVIDER_PUBLIC_URL}/api/v1/order-receipt`,
  },
];

async function postSigned(path: string, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const id = tryIdentity();
  if (!id) return { ok: false, status: 0, text: "identity not initialized" };
  const raw = JSON.stringify(body);
  const headers = await signRequest({
    method: "POST", path, body: raw,
    privkeyHex: id.privkey, pubkeyHex: id.pubkey,
  });
  const r = await fetch(`${REGISTRY_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

export async function registerWithRegistry(): Promise<{ ok: boolean; pubkey: string; reason?: string }> {
  await ensureIdentity();
  const id = tryIdentity()!;
  try {
    const r = await postSigned("/api/v1/sellers/register", {
      pubkey: id.pubkey,
      name: PROVIDER_NAME,
      url: PROVIDER_PUBLIC_URL,
      description: PROVIDER_DESCRIPTION,
      services: SERVICES,
    });
    if (!r.ok) {
      logger.warn({ status: r.status, body: r.text.slice(0, 200) }, "[registry] register failed");
      return { ok: false, pubkey: id.pubkey, reason: r.text.slice(0, 200) };
    }
    logger.info({ pubkey: id.pubkey, registry: REGISTRY_URL }, "[registry] registered");
    return { ok: true, pubkey: id.pubkey };
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "[registry] register error");
    return { ok: false, pubkey: id.pubkey, reason: (e as Error).message };
  }
}

export function startHeartbeat() {
  if (_heartbeatInterval) return;
  // 60s heartbeat; ignore errors silently.
  _heartbeatInterval = setInterval(() => {
    void registerWithRegistry().catch(() => {});
  }, 60_000);
}

/** Fire-and-forget: record a transaction. Never throws. */
export function recordTxFireAndForget(args: {
  buyer_pubkey: string | null;
  service_local_id: string;
  amount_sats: number;
  payment_hash: string;
  platform_fee_sats?: number;
}): void {
  // Only attempt if we have an identity AND the buyer pubkey is known.
  const id = tryIdentity();
  if (!id) return;
  // If the buyer is anonymous (no signed buyer header), use "unknown".
  const buyer_pubkey = args.buyer_pubkey ?? "unknown";
  const txId = `tx_${args.payment_hash.slice(0, 24)}`;
  const service_id = `${id.pubkey.slice(0, 8)}:${args.service_local_id}`;
  const body = {
    id: txId,
    buyer_pubkey,
    seller_pubkey: id.pubkey,
    service_id,
    amount_sats: args.amount_sats,
    platform_fee_sats: args.platform_fee_sats ?? 0,
    payment_hash: args.payment_hash,
    settled_at: Date.now(),
  };
  // Promise we don't await — fire and forget.
  void postSigned("/api/v1/transactions/record", body)
    .then(r => {
      if (!r.ok) logger.warn({ status: r.status, body: r.text.slice(0, 200) }, "[registry] tx record failed");
    })
    .catch(e => {
      logger.warn({ err: (e as Error).message }, "[registry] tx record error");
    });
}

export const REGISTRY_URL_INFO = REGISTRY_URL;
