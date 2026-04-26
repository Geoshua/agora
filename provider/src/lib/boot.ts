// Provider boot — runs once per process, lazily on the first inbound
// request. Generates identity if needed, then self-registers with the
// Andromeda registry and starts the heartbeat loop.
//
// Failures are logged but never thrown — registry being down must not
// break the provider.

import { ensureIdentity } from "./identity";
import { registerWithRegistry, startHeartbeat } from "./registry-client";
import { logger } from "./log";

let _booted: Promise<void> | null = null;

export function ensureBooted(): Promise<void> {
  if (_booted) return _booted;
  _booted = (async () => {
    try {
      await ensureIdentity();
      // First registration. Don't await heartbeat startup — it self-loops.
      await registerWithRegistry();
      startHeartbeat();
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "[boot] init failed");
    }
  })();
  return _booted;
}
