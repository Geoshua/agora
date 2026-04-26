// Signed-request verification helper for the registry's POST routes.

import { verifyRequest, HDR_PUBKEY, HDR_TIMESTAMP, HDR_SIG } from "@andromeda/core";

export type SigVerifyResult =
  | { ok: true; pubkey: string }
  | { ok: false; status: number; reason: string };

export async function verifySignedRequest(
  req: Request,
  rawBody: string,
): Promise<SigVerifyResult> {
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  if (!headers[HDR_PUBKEY] || !headers[HDR_SIG] || !headers[HDR_TIMESTAMP]) {
    return { ok: false, status: 401, reason: "missing signature headers" };
  }
  const r = await verifyRequest({
    method: req.method,
    path: url.pathname,
    body: rawBody,
    headers,
  });
  if (!r.ok) return { ok: false, status: 401, reason: r.reason };
  return { ok: true, pubkey: r.pubkey };
}

/** Convenience: read body as text once and parse JSON. */
export async function readBody<T = unknown>(req: Request): Promise<{ raw: string; json: T | null }> {
  const raw = await req.text();
  if (!raw) return { raw: "", json: null };
  try { return { raw, json: JSON.parse(raw) as T }; }
  catch { return { raw, json: null }; }
}
