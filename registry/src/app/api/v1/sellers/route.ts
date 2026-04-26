// GET /v1/sellers — paginated, public.

import { listSellers } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const rows = listSellers({ limit, offset });
  return Response.json({
    sellers: rows.map(r => ({
      pubkey: r.pubkey, name: r.name, url: r.url, honor: r.honor,
      description: r.description, registered_at: new Date(r.registered_at).toISOString(),
      last_active_at: new Date(r.last_active_at).toISOString(),
    })),
    count: rows.length,
    limit, offset,
  });
}
