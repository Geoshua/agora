import React from "react";
import { Section } from "./Section";
import { useTransactionsStore } from "../lib/store";

export function Transactions() {
  const { transactions, loading, error, refresh } = useTransactionsStore();

  React.useEffect(() => { void refresh(); }, [refresh]);

  const total = transactions.reduce((s, t) => s + (t.amount_sats || 0), 0);

  return (
    <Section
      title="Transactions"
      subtitle={`Local log · ${transactions.length} entries · ${total.toLocaleString()} sat total`}
      right={
        <button onClick={() => void refresh()}
          className="rounded-md border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800">
          Refresh
        </button>
      }
    >
      {error && <p className="mb-3 rounded bg-red-900/30 px-2 py-1 text-xs text-red-300">{error}</p>}
      <div className="overflow-auto rounded-lg border border-zinc-800" style={{ maxHeight: 320 }}>
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Service / endpoint</th>
              <th className="px-3 py-2 font-medium">Seller</th>
              <th className="px-3 py-2 text-right font-medium">Sats</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                No transactions logged at <code className="font-mono">~/.andromeda/transactions.log</code>.
              </td></tr>
            )}
            {transactions.map((t, i) => (
              <tr key={i} className="border-t border-zinc-800">
                <td className="px-3 py-2 whitespace-nowrap text-zinc-300">{new Date(t.ts_ms).toLocaleString()}</td>
                <td className="px-3 py-2 text-zinc-300">{t.kind}</td>
                <td className="px-3 py-2 font-mono text-zinc-400">{t.service ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-zinc-500">
                  {t.seller_name ?? (t.seller_pubkey ? t.seller_pubkey.slice(0, 12) + "…" : "—")}
                </td>
                <td className="px-3 py-2 text-right font-mono">{t.amount_sats.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
