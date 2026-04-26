// Structured logging — pino, JSON to stdout. Each log line gets a
// request_id, the endpoint, status, latency, and sats charged so the
// /stats aggregate and an external log aggregator both have what they
// need.

import pino from "pino";
import { recordRequest } from "./db";
import { ipOf } from "./ratelimit";
import { newRequestId } from "./errors";
import { ensureBooted } from "./boot";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "lumen-provider" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type RequestContext = {
  request_id: string;
  ip: string;
  ua: string;
  endpoint: string;
  started: number;
  finalize: (status: number, sats_charged?: number) => void;
};

export function trace(req: Request, endpoint: string): RequestContext {
  // Lazy boot on first request — generates identity & registers with
  // registry. Fire-and-forget; never blocks the request.
  void ensureBooted();

  const request_id = req.headers.get("x-request-id") ?? newRequestId();
  const ip = ipOf(req);
  const ua = req.headers.get("user-agent") ?? "";
  const started = Date.now();
  let done = false;

  return {
    request_id, ip, ua, endpoint, started,
    finalize(status, sats_charged = 0) {
      if (done) return;
      done = true;
      const latency_ms = Date.now() - started;
      logger.info({ request_id, ip, endpoint, status, sats_charged, latency_ms }, "req");
      try {
        recordRequest({ request_id, ip, endpoint, status, sats_charged, latency_ms, ua });
      } catch (e) {
        logger.warn({ err: (e as Error).message }, "request log failed");
      }
    },
  };
}

// Wrap a Response so its status is captured + a x-request-id header is set.
export function finalize(ctx: RequestContext, res: Response, sats_charged = 0): Response {
  const headers = new Headers(res.headers);
  if (!headers.has("x-request-id")) headers.set("x-request-id", ctx.request_id);
  ctx.finalize(res.status, sats_charged);
  return new Response(res.body, { status: res.status, headers });
}
