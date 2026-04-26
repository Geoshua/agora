// /activity — live tape of every settled transaction in the registry.
// SSR-rendered, refreshes whenever you reload (no polling — real-time
// streams would need SSE through the control plane).

import Link from "next/link";
import { listRecentTransactions, type RecentTx } from "@/lib/registry";
import { PubkeyDisplay } from "@/components/pubkey";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ActivityPage() {
  const res = await listRecentTransactions(100);
  const txs: RecentTx[] = res?.transactions ?? [];
  const total = txs.reduce((a, t) => a + t.amount_sats, 0);
  const fees  = txs.reduce((a, t) => a + (t.platform_fee_sats ?? 0), 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 text-zinc-100">
      <div className="mb-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-amber-400">
          ⚡ live activity
        </div>
        <h1 className="mt-2 font-serif text-4xl font-light tracking-tight text-zinc-50">
          Every settled transaction
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-400">
          The most recent {txs.length} payments routed through the Andromeda registry.
          One line per buyer→seller settle. Refresh to update.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Transactions" value={txs.length.toString()} />
        <Stat label="Total moved" value={`${total.toLocaleString()} sat`} accent="amber" />
        <Stat label="Platform fees" value={`${fees.toLocaleString()} sat`} dim />
      </div>

      {txs.length === 0 ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-8 text-center text-zinc-400">
          No transactions yet. Run <code className="text-cyan-300">node scripts/real-multi.js</code> to make some.
        </div>
      ) : (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40">
          <div className="grid grid-cols-[110px_1fr_1fr_110px_120px] gap-3 border-b border-zinc-800 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <div>When</div>
            <div>Buyer</div>
            <div>Seller / Service</div>
            <div className="text-right">Amount</div>
            <div className="text-right">Fee · Hash</div>
          </div>
          {txs.map((t) => (
            <div
              key={t.id}
              className="grid grid-cols-[110px_1fr_1fr_110px_120px] items-center gap-3 border-b border-zinc-900 px-4 py-3 font-mono text-[12.5px] last:border-b-0 hover:bg-zinc-900/40"
            >
              <div className="text-zinc-500">{relativeTime(new Date(t.settled_at).toISOString())}</div>
              <div className="truncate">
                <PubkeyDisplay pubkey={t.buyer_pubkey} />
              </div>
              <div className="truncate">
                <Link
                  href={`/sellers/${t.seller_pubkey}`}
                  className="text-cyan-300 hover:text-amber-300 hover:underline"
                >
                  {t.seller_name ?? "(unknown seller)"}
                </Link>
                <span className="ml-2 text-zinc-500">·</span>
                <span className="ml-2 text-zinc-300">{t.service_name ?? t.service_id}</span>
              </div>
              <div className="text-right font-semibold text-amber-400">
                {t.amount_sats.toLocaleString()} sat
              </div>
              <div className="text-right text-[11px] text-zinc-500">
                {t.platform_fee_sats > 0 ? `${t.platform_fee_sats}f · ` : ""}
                {t.payment_hash.slice(0, 8)}…
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 text-[12px] text-zinc-500">
        Source: <code className="text-cyan-300">GET /api/v1/transactions/recent</code> on the registry.
        Mock-mode entries and mainnet-mode entries are visually identical here — check the seller's <code>wallet_mode</code> at <Link href="/sellers" className="text-cyan-300 hover:underline">/sellers</Link>.
      </div>
    </main>
  );
}

function Stat({ label, value, accent, dim }: { label: string; value: string; accent?: "amber"; dim?: boolean }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={`mt-2 text-xl ${accent === "amber" ? "text-amber-400" : dim ? "text-zinc-400" : "text-zinc-100"}`}>
        {value}
      </div>
    </div>
  );
}
