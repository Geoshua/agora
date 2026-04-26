import React from "react";
import { Section } from "./Section";
import { useSubscriptionsStore, useSellersStore } from "../lib/store";

export function Subscriptions() {
  const { subscriptions, loading, error, refresh, cancel } = useSubscriptionsStore();
  const sellers = useSellersStore((s) => s.sellers);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const sellerName = (pubkey: string) => sellers.find((s) => s.pubkey === pubkey)?.name ?? `${pubkey.slice(0, 10)}…`;

  return (
    <Section
      title="Active subscriptions"
      subtitle="Prepaid sat-per-event services. Runway = balance / price."
      right={
        <button onClick={() => void refresh()}
          className="rounded-md border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">
          Refresh
        </button>
      }
    >
      {error && <p className="mb-3 rounded bg-red-900/30 px-2 py-1 text-xs text-red-300">{error}</p>}
      {loading && subscriptions.length === 0 && <p className="text-xs text-zinc-500">Loading…</p>}
      {!loading && subscriptions.length === 0 && (
        <p className="text-sm text-zinc-500">No active subscriptions yet.</p>
      )}
      <div className="space-y-2">
        {subscriptions.map((s) => (
          <div key={s.subscription_id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{sellerName(s.seller_pubkey)}</div>
                <div className="text-[11px] font-mono text-zinc-500">{s.service_local_id}</div>
              </div>
              <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                s.status === "active" ? "bg-emerald-900/40 text-emerald-300" : "bg-zinc-800 text-zinc-400"
              }`}>{s.status}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Balance</div>
                <div className="font-mono">{s.balance_sats.toLocaleString()} sat</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Per event</div>
                <div className="font-mono">{s.per_event_sats.toLocaleString()} sat</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Runway</div>
                <div className="font-mono">
                  {s.events_remaining != null ? `${s.events_remaining.toLocaleString()} events` : "—"}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() => { if (confirm(`Cancel subscription ${s.subscription_id}?`)) void cancel(s.subscription_id); }}
                className="rounded-md border border-red-900/50 bg-red-950/30 px-2 py-1 text-[11px] text-red-200 hover:bg-red-900/40"
              >
                Cancel
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
