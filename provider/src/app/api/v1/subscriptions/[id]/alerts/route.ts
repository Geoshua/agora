import { listAlerts, getSubscription } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSubscription(id)) return Response.json({ error: "no such subscription" }, { status: 404 });
  const url = new URL(req.url);
  const sinceStr = url.searchParams.get("since") ?? "0";
  const since = Number.isFinite(parseInt(sinceStr, 10)) ? parseInt(sinceStr, 10) : 0;
  const rows = listAlerts(id, since);
  return Response.json({
    subscription_id: id,
    since,
    alerts: rows.map(r => ({
      id: r.id,
      kind: r.kind,
      payload: JSON.parse(r.payload_json),
      signature: r.signature,
      sats_charged: r.sats_charged,
      created_at: new Date(r.created_at).toISOString(),
      created_at_ms: r.created_at,
    })),
    count: rows.length,
  });
}
