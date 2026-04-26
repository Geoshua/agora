import { sellerStats, getSeller } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey } = await params;
  const s = getSeller(pubkey);
  if (!s) return Response.json({ error: "no such seller" }, { status: 404 });
  const stats = sellerStats(pubkey);
  return Response.json({
    pubkey, name: s.name, honor: s.honor,
    tx_count: stats.tx_count, sats_earned: stats.sats_earned,
  });
}
