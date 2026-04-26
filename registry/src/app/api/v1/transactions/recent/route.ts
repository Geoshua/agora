// GET /api/v1/transactions/recent?limit=50
//
// Public read of the most recent settled transactions, for the public
// web index's /activity feed. No auth (the data is already aggregate-
// public via /sellers/:pubkey/stats; this just lets us render a per-tx
// live tape without exposing more than is already inferrable).

import { listRecentTransactions } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const txs = listRecentTransactions(Number.isFinite(limit) ? limit : 50);
  return Response.json(
    {
      schema: "agora.transactions.v1",
      count: txs.length,
      transactions: txs.map((t) => ({
        id: t.id,
        buyer_pubkey: t.buyer_pubkey,
        seller_pubkey: t.seller_pubkey,
        seller_name: t.seller_name ?? null,
        service_id: t.service_id,
        service_name: t.service_name ?? null,
        amount_sats: t.amount_sats,
        platform_fee_sats: t.platform_fee_sats,
        payment_hash: t.payment_hash,
        settled_at: t.settled_at,
      })),
    },
    {
      headers: { "cache-control": "public, max-age=2, s-maxage=2" },
    },
  );
}
