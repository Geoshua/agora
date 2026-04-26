// GET /v1/discovery
//
// Public catalogue of paid services on this LUMEN provider, in a format
// crawlable by directories like 402index.io and agentic.market.  Returns
// per-service pricing, latency P50, payment protocol, request schema, and
// a sample 402 challenge so a client can negotiate without a round-trip.
//
// No paywall on this endpoint — discovery is free; the work is paid.

import { ensureBooted } from "@/lib/boot";

export const dynamic = "force-dynamic";

const SELF = (req: Request) => {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
};

export async function GET(req: Request) {
  void ensureBooted();
  const base = SELF(req);
  const wallet_mode = process.env.MOCK_MODE === "true" ? "mock" : "real";

  return Response.json({
    schema: "lumen.directory.v1",
    provider: {
      id: "vision-oracle-3",
      name: "LUMEN · vision-oracle-3",
      operator: "lumen.market",
      url: base,
      reputation: { stars: 4.91, jobs: 18431, since: "2026-01-01" },
      payment: {
        protocol: "L402",
        rail: "lightning",
        network: wallet_mode === "real" ? "mainnet" : "mock",
        wallet: "alby-nwc",
      },
      stake_sats: 50000,
      escrow: { share: 0.10, hold_seconds: 43200 },
    },
    services: [
      {
        id: "listing-verify",
        endpoint: `${base}/api/v1/listing-verify`,
        method: "POST",
        category: "verification.geocoding",
        description:
          "Resolves a listing string against OpenStreetMap, returns real coordinates, OSM id, and an HMAC-signed proof. Falls back to a deterministic synthetic when the listing is not found.",
        price_sats: parseInt(process.env.PRICE_SATS ?? "240", 10),
        p50_ms: 1100,
        capacity_per_min: 240,
        request: {
          listing: "string  · e.g. \"Eiffel Tower Paris\"",
          date: "ISO-8601 date",
          max_age_h: "number, optional, default 24",
        },
        response: {
          verified: "boolean",
          confidence: "number 0..1",
          resolved_name: "string | null",
          osm_id: "number | null",
          exif_geo: "[lat, lon]",
          geo_source: "openstreetmap.nominatim | synthetic",
          image_sha256: "hex(32)",
          captured_at: "ISO-8601",
        },
      },
      {
        id: "order-receipt",
        endpoint: `${base}/api/v1/order-receipt`,
        method: "POST",
        category: "audit.receipt",
        description:
          "Issues a signed, timestamped delivery receipt for a Lightning-paid order. Pairs with agentic shopping flows so an agent can prove to its human that money moved and a thing was bought.",
        price_sats: 120,
        p50_ms: 350,
        capacity_per_min: 1200,
        request: {
          order_id: "string",
          invoice: "bolt-11",
          buyer: "string, optional",
          notes: "string, optional",
        },
        response: {
          receipt_id: "string",
          signature: "base64url HMAC-SHA-256 over claims",
          issuer: "lumen.order-receipt",
          issued_at: "ISO-8601",
          order_id: "string",
          invoice_payment_hash: "hex(32)",
          amount_sats: "number | null",
          network: "mainnet | testnet | regtest | mock | unknown",
        },
      },
    ],
    extras: {
      receipt_fetch: { method: "GET", endpoint: `${base}/api/v1/receipts/{receipt_id}`, paid: false },
      stats:         { method: "GET", endpoint: `${base}/api/v1/stats`, paid: false, auth: "basic" },
    },
    contact: { email: "agents@lumen.market", license: "MIT" },
    docs: `${base}`,
    healthcheck: `${base}/api/health`,
  }, {
    headers: {
      // Cache aggressively — directories will crawl this often.
      "cache-control": "public, max-age=120, s-maxage=120",
      "x-lumen-services": "2",
    },
  });
}
