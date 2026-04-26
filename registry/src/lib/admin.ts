// Admin auth for /v1/admin/* and /v1/platform/* routes.
//
// Fails secure: if ADMIN_SECRET is not set in the environment, every admin
// request is rejected with 503. This avoids the "dev fallback secret slips
// into production" footgun. Set ADMIN_SECRET to a long random value in every
// environment that uses admin endpoints — including local dev (drop it in
// registry/.env.local).

export function requireAdmin(req: Request): Response | null {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || expected.length < 16) {
    return Response.json(
      { error: "admin endpoints disabled (ADMIN_SECRET not set or too short)" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (provided !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
