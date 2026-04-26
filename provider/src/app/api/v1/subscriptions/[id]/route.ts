import { getSubscription } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sub = getSubscription(id);
  if (!sub) return Response.json({ error: "no such subscription" }, { status: 404 });
  return Response.json({
    id: sub.id,
    subscriber_pubkey: sub.subscriber_pubkey,
    service_local_id: sub.service_local_id,
    per_event_sats: sub.per_event_sats,
    balance_sats: sub.balance_sats,
    status: sub.status,
    config: JSON.parse(sub.config_json),
    created_at: new Date(sub.created_at).toISOString(),
    updated_at: new Date(sub.updated_at).toISOString(),
  });
}
