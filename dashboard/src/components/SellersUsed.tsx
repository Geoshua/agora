import React from "react";
import { Section } from "./Section";
import { useTransactionsStore, useSellersStore } from "../lib/store";

interface AggRow {
  pubkey: string;
  name: string;
  count: number;
  total: number;
  last: number;
  url?: string;
  honor?: number;
}

export function SellersUsed() {
  const txs = useTransactionsStore((s) => s.transactions);
  const sellers = useSellersStore((s) => s.sellers);
  const refreshSellers = useSellersStore((s) => s.refresh);
  const refreshTx = useTransactionsStore((s) => s.refresh);

  React.useEffect(() => { void refreshSellers(); void refreshTx(); }, [refreshSellers, refreshTx]);

  const sellerByPk = React.useMemo(() => {
    const m = new Map(sellers.map((s) => [s.pubkey, s] as const));
    return m;
  }, [sellers]);

  const rows: AggRow[] = React.useMemo(() => {
    const grouped = new Map<string, AggRow>();
    for (const t of txs) {
      // Fall back to provider_url when no pubkey is recorded yet (provider
      // legacy txs may lack one). Use a synthetic key derived from URL.
      const key = t.seller_pubkey ?? `url:${t.provider_url ?? "unknown"}`;
      const seller = t.seller_pubkey ? sellerByPk.get(t.seller_pubkey) : undefined;
      const existing = grouped.get(key);
      const next: AggRow = existing ?? {
        pubkey: t.seller_pubkey ?? key,
        name: seller?.name ?? t.seller_name ?? (t.provider_url ? new URL(t.provider_url).host : "unknown"),
        count: 0, total: 0, last: 0,
        url: seller?.url ?? t.provider_url ?? undefined,
        honor: seller?.honor,
      };
      next.count += 1;
      next.total += t.amount_sats;
      next.last = Math.max(next.last, t.ts_ms);
      grouped.set(key, next);
    }
    return Array.from(grouped.values()).sort((a, b) => b.total - a.total);
  }, [txs, sellerByPk]);

  return (
    <Section
      title="Sellers I've used"
      subtitle="Grouped from local transaction log"
    >
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No sellers seen yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">Seller</th>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Total sats</th>
                <th className="px-3 py-2 font-medium">Last</th>
                <th className="px-3 py-2 text-right font-medium">Honor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pubkey} className="border-t border-zinc-800">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 font-mono text-zinc-500">{r.url ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.count}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{new Date(r.last).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.honor ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
