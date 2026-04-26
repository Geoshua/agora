import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  try {
    db().prepare("SELECT 1").get();
    dbOk = true;
  } catch { dbOk = false; }
  return Response.json({
    ok: true,
    service: "andromeda-registry",
    rev: "v0.1.0",
    db: dbOk ? "ok" : "down",
    endpoints: [
      "GET  /v1/health",
      "POST /v1/sellers/register",
      "GET  /v1/sellers",
      "GET  /v1/sellers/:pubkey",
      "POST /v1/services/upsert",
      "GET  /v1/services",
      "GET  /v1/services/search",
      "POST /v1/transactions/record",
      "GET  /v1/sellers/:pubkey/stats",
    ],
  });
}
