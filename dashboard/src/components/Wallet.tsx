import React from "react";
import { Section } from "./Section";
import { useWalletStore, useTransactionsStore } from "../lib/store";

const ALBY_HUB_URL = "https://albyhub.com/";

export function Wallet() {
  const { balance, loading, error, refresh } = useWalletStore();
  const txs = useTransactionsStore((s) => s.transactions);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const last10 = txs.slice(0, 10);

  return (
    <Section
      title="Wallet"
      subtitle="Lightning balance via NWC, last 10 transactions"
      right={
        <div className="flex gap-2">
          <button
            onClick={() => window.open(ALBY_HUB_URL, "_blank", "noopener")}
            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold hover:bg-emerald-500"
          >
            Top-up via Alby Hub
          </button>
          <button
            onClick={() => void refresh()}
            className="rounded-md border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-zinc-900 p-4">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Balance</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">
            {balance?.balance_sats != null ? balance.balance_sats.toLocaleString() : "—"}
            <span className="ml-1 text-sm font-normal text-zinc-400">sat</span>
          </div>
        </div>
        <div className="rounded-lg bg-zinc-900 p-4">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Mode</div>
          <div className="mt-1 text-2xl font-bold tracking-tight capitalize">
            {balance?.mode ?? (loading ? "…" : "?")}
          </div>
        </div>
      </div>

      {error && <p className="mb-3 rounded bg-red-900/30 px-2 py-1 text-xs text-red-300">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Service</th>
              <th className="px-3 py-2 text-right font-medium">Sats</th>
            </tr>
          </thead>
          <tbody>
            {last10.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-3 text-center text-zinc-500">No transactions yet.</td></tr>
            )}
            {last10.map((t, i) => (
              <tr key={i} className="border-t border-zinc-800">
                <td className="px-3 py-2 text-zinc-300">{new Date(t.ts_ms).toLocaleString()}</td>
                <td className="px-3 py-2 text-zinc-300">{t.kind}</td>
                <td className="px-3 py-2 font-mono text-zinc-400">{t.service ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{t.amount_sats.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
