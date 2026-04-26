// Tiny client for the MCP control plane (HTTP, localhost only).
// Endpoints: see mcp/control-plane.js. All require Bearer token except /healthz.

export type ControlPlaneConfig = { baseUrl: string; token: string };

const LS_KEY = "andromeda.controlPlane";
// Endpoint paths used by the SPA. Kept as exported strings so the build
// gate's "string match in built bundle" assertion has stable handles.
export const CP_PATHS = {
  healthz: "/healthz",
  session: "/session",
  budget: "/session/budget",
  killSwitch: "/session/kill-switch",
  balance: "/balance",
  transactions: "/transactions",
  subscriptions: "/subscriptions",
  cancelSubscription: (id: string) => `/subscriptions/${encodeURIComponent(id)}/cancel`,
  sellers: "/sellers",
} as const;

export function loadConfig(): ControlPlaneConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (typeof j?.baseUrl === "string" && typeof j?.token === "string") return j;
    return null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: ControlPlaneConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

export function clearConfig() { localStorage.removeItem(LS_KEY); }

async function req<T = unknown>(
  cfg: ControlPlaneConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const r = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
    },
  });
  if (!r.ok) {
    let body: unknown = null;
    try { body = await r.json(); } catch {}
    throw new Error(`${path} → ${r.status} ${JSON.stringify(body)}`);
  }
  return (await r.json()) as T;
}

export type Session = {
  budget: {
    budget_sats: number;
    spent_sats: number;
    remaining_sats: number;
    started_at: string;
    kill_switch_active: boolean;
  };
  kill_switch_active: boolean;
  subscriptions: Record<string, unknown>;
  provider_url: string;
  registry_url: string;
  wallet_mode: "mock" | "real";
};

export type Balance = { mode: "mock" | "real"; balance_sats: number | null; error?: string };

export type Transaction = {
  ts_ms: number;
  kind: string;
  amount_sats: number;
  seller_pubkey?: string | null;
  seller_name?: string | null;
  service?: string | null;
  provider_url?: string | null;
  payment_hash?: string | null;
  note?: string | null;
};

export type Subscription = {
  subscription_id: string;
  seller_pubkey: string;
  seller_url: string;
  service_local_id: string;
  per_event_sats: number;
  balance_sats: number;
  events_remaining: number | null;
  status: string;
  last_seen_alert_ms: number;
};

export type Seller = {
  pubkey: string;
  name: string;
  url: string;
  honor: number;
  last_active_at?: number;
  peer_reviewed?: boolean;
  review_count?: number;
};

export const api = {
  async healthz(cfg: ControlPlaneConfig) {
    const r = await fetch(`${cfg.baseUrl}${CP_PATHS.healthz}`);
    if (!r.ok) throw new Error(`healthz ${r.status}`);
    return r.json() as Promise<{ ok: boolean; port: number }>;
  },
  session(cfg: ControlPlaneConfig) { return req<Session>(cfg, CP_PATHS.session); },
  setBudget(cfg: ControlPlaneConfig, sats: number) {
    return req<{ ok: true; new_status: Session["budget"] }>(cfg, CP_PATHS.budget, {
      method: "POST",
      body: JSON.stringify({ sats }),
    });
  },
  setKillSwitch(cfg: ControlPlaneConfig, active: boolean) {
    return req<{ ok: true; kill_switch_active: boolean }>(cfg, CP_PATHS.killSwitch, {
      method: "POST",
      body: JSON.stringify({ active }),
    });
  },
  balance(cfg: ControlPlaneConfig) { return req<Balance>(cfg, CP_PATHS.balance); },
  transactions(cfg: ControlPlaneConfig, limit = 100) {
    return req<{ transactions: Transaction[]; count: number; log_path: string }>(
      cfg, `${CP_PATHS.transactions}?limit=${limit}`,
    );
  },
  subscriptions(cfg: ControlPlaneConfig) {
    return req<{ subscriptions: Subscription[]; count: number }>(cfg, CP_PATHS.subscriptions);
  },
  cancelSubscription(cfg: ControlPlaneConfig, id: string) {
    return req<{ ok?: boolean; refunded_sats?: number; status?: string }>(
      cfg, CP_PATHS.cancelSubscription(id), { method: "POST" },
    );
  },
  sellers(cfg: ControlPlaneConfig) {
    return req<{ sellers: Seller[]; count: number }>(cfg, CP_PATHS.sellers);
  },
};
