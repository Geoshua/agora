import { wallet } from "@/lib/wallet";
import { db } from "@/lib/db";
import { ensureBooted } from "@/lib/boot";
import { tryIdentity } from "@/lib/identity";

export async function GET() {
  // Trigger lazy boot so this also self-registers if not yet done.
  void ensureBooted();

  // touch the DB to confirm it's reachable + report the row count.
  let invoices = 0, receipts = 0;
  try {
    invoices = (db().prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n;
    receipts = (db().prepare("SELECT COUNT(*) AS n FROM receipts").get() as { n: number }).n;
  } catch { /* db init may fail on first call from edge runtimes */ }
  const id = tryIdentity();

  return Response.json({
    ok: true,
    service: "lumen-provider",
    rev: "v0.3.0",
    wallet_mode: wallet().kind,
    price_sats: parseInt(process.env.PRICE_SATS ?? "240", 10),
    andromeda_pubkey: id?.pubkey ?? null,
    persistence: { invoices, receipts },
    endpoints: [
      "GET  /api/health",
      "GET  /api/v1/discovery",
      "GET  /api/v1/stats           (admin)",
      "GET  /api/v1/receipts/{id}",
      "POST /api/v1/listing-verify  (240 sat)",
      "POST /api/v1/order-receipt   (120 sat)",
    ],
  });
}
