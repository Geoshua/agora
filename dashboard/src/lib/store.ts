// One Zustand store per concern. Cross-cutting concerns (config) live
// in `useConfigStore`; UI sections subscribe to whichever slice they need.

import { create } from "zustand";
import {
  api, ControlPlaneConfig, loadConfig, saveConfig, clearConfig,
  Session, Balance, Transaction, Subscription, Seller,
} from "./controlPlane";

// ── config (control-plane URL + token) ────────────────────────────────
interface ConfigState {
  config: ControlPlaneConfig | null;
  setConfig: (c: ControlPlaneConfig) => void;
  clear: () => void;
}
export const useConfigStore = create<ConfigState>((set) => ({
  config: loadConfig(),
  setConfig: (c) => { saveConfig(c); set({ config: c }); },
  clear: () => { clearConfig(); set({ config: null }); },
}));

// ── helpers ───────────────────────────────────────────────────────────
function withConfig<T>(fn: (cfg: ControlPlaneConfig) => Promise<T>): Promise<T> {
  const cfg = useConfigStore.getState().config;
  if (!cfg) return Promise.reject(new Error("control plane not configured"));
  return fn(cfg);
}

// ── session ───────────────────────────────────────────────────────────
interface SessionState {
  session: Session | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setBudget: (sats: number) => Promise<void>;
  setKillSwitch: (active: boolean) => Promise<void>;
}
export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try { const s = await withConfig(api.session); set({ session: s, loading: false }); }
    catch (e: unknown) { set({ error: (e as Error).message, loading: false }); }
  },
  setBudget: async (sats) => {
    try {
      await withConfig((c) => api.setBudget(c, sats));
      const s = await withConfig(api.session);
      set({ session: s });
    } catch (e: unknown) { set({ error: (e as Error).message }); }
  },
  setKillSwitch: async (active) => {
    try {
      await withConfig((c) => api.setKillSwitch(c, active));
      const s = await withConfig(api.session);
      set({ session: s });
    } catch (e: unknown) { set({ error: (e as Error).message }); }
  },
}));

// ── wallet (balance) ──────────────────────────────────────────────────
interface WalletState {
  balance: Balance | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
export const useWalletStore = create<WalletState>((set) => ({
  balance: null,
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try { const b = await withConfig(api.balance); set({ balance: b, loading: false }); }
    catch (e: unknown) { set({ error: (e as Error).message, loading: false }); }
  },
}));

// ── transactions ──────────────────────────────────────────────────────
interface TxState {
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
export const useTransactionsStore = create<TxState>((set) => ({
  transactions: [],
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const r = await withConfig((c) => api.transactions(c, 200));
      set({ transactions: r.transactions, loading: false });
    } catch (e: unknown) { set({ error: (e as Error).message, loading: false }); }
  },
}));

// ── subscriptions ─────────────────────────────────────────────────────
interface SubsState {
  subscriptions: Subscription[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
}
export const useSubscriptionsStore = create<SubsState>((set) => ({
  subscriptions: [],
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const r = await withConfig(api.subscriptions);
      set({ subscriptions: r.subscriptions, loading: false });
    } catch (e: unknown) { set({ error: (e as Error).message, loading: false }); }
  },
  cancel: async (id) => {
    try {
      await withConfig((c) => api.cancelSubscription(c, id));
      const r = await withConfig(api.subscriptions);
      set({ subscriptions: r.subscriptions });
    } catch (e: unknown) { set({ error: (e as Error).message }); }
  },
}));

// ── sellers ───────────────────────────────────────────────────────────
interface SellersState {
  sellers: Seller[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
export const useSellersStore = create<SellersState>((set) => ({
  sellers: [],
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const r = await withConfig(api.sellers);
      set({ sellers: r.sellers ?? [], loading: false });
    } catch (e: unknown) { set({ error: (e as Error).message, loading: false }); }
  },
}));
