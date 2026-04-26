// POST /v1/transactions/record — seller-signed.
// Body: { id, buyer_pubkey, seller_pubkey, service_id, amount_sats,
//         platform_fee_sats?, payment_hash, settled_at? }

import { recordTransaction, bumpLastActive } from "@/lib/db";
import { verifySignedRequest, readBody } from "@/lib/sig";

export const dynamic = "force-dynamic";

type RecordBody = {
  id: string;
  buyer_pubkey: string;
  seller_pubkey: string;
  service_id: string;
  amount_sats: number;
  platform_fee_sats?: number;
  payment_hash: string;
  settled_at?: number;
};

export async function POST(req: Request) {
  const { raw, json } = await readBody<RecordBody>(req);
  const auth = await verifySignedRequest(req, raw);
  if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status });
  if (!json) return Response.json({ error: "invalid JSON body" }, { status: 400 });

  for (const f of ["id", "buyer_pubkey", "seller_pubkey", "service_id", "amount_sats", "payment_hash"] as const) {
    if (!json[f]) return Response.json({ error: `missing field: ${f}` }, { status: 400 });
  }
  if (json.seller_pubkey !== auth.pubkey) {
    return Response.json({ error: "transaction must be signed by seller" }, { status: 403 });
  }

  const r = recordTransaction({
    id: json.id, buyer_pubkey: json.buyer_pubkey, seller_pubkey: json.seller_pubkey,
    service_id: json.service_id, amount_sats: json.amount_sats,
    platform_fee_sats: json.platform_fee_sats ?? 0,
    payment_hash: json.payment_hash, settled_at: json.settled_at,
  });
  bumpLastActive(json.seller_pubkey);
  return Response.json({ ok: true, recorded: r.inserted, idempotent: !r.inserted });
}
