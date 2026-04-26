import Link from "next/link";
import { notFound } from "next/navigation";
import { getSellerDetail, REGISTRY_URL } from "@/lib/registry";
import { HonorStars } from "@/components/honor";
import { PubkeyDisplay } from "@/components/pubkey";
import { TypeChip, Tag } from "@/components/type-chip";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SellerDetailPage(props: {
  params: Promise<{ pubkey: string }>;
}) {
  const { pubkey } = await props.params;
  const detail = await getSellerDetail(pubkey);
  if (!detail) notFound();

  const { seller, services, stats } = detail;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <Link
        href="/sellers"
        className="font-mono text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 hover:text-amber"
      >
        ← all sellers
      </Link>

      <header className="mt-4 mb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="font-serif text-4xl">{seller.name}</h1>
          <HonorStars honor={seller.honor} />
        </div>
        <p className="mt-3 text-zinc-600 dark:text-zinc-300 max-w-2xl">
          {seller.description || (
            <span className="italic text-zinc-400">No description.</span>
          )}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <PubkeyDisplay pubkey={seller.pubkey} long />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono text-zinc-500 dark:text-zinc-400">
          <span>
            registered <span className="text-zinc-700 dark:text-zinc-200">{relativeTime(seller.registered_at)}</span>
          </span>
          <span>
            last active <span className="text-zinc-700 dark:text-zinc-200">{relativeTime(seller.last_active_at)}</span>
          </span>
          <span>
            <a
              href={seller.url}
              target="_blank"
              rel="noopener"
              className="hover:text-amber underline-offset-2 hover:underline"
            >
              {seller.url}
            </a>
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge ok={seller.badges.peer_reviewed}>
            {seller.badges.peer_reviewed ? "peer-reviewed" : "no peer review"}
          </Badge>
          {seller.badges.review_count > 0 && (
            <Badge ok>
              {seller.badges.review_count} review
              {seller.badges.review_count === 1 ? "" : "s"}
            </Badge>
          )}
          {seller.badges.max_rollup > 0 && (
            <Badge ok>max rollup {seller.badges.max_rollup}</Badge>
          )}
        </div>
      </header>

      <section className="mb-10">
        <h2 className="font-serif text-2xl mb-4">Services</h2>
        {services.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
            This seller has no services listed.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {services.map((s) => (
              <Link
                key={s.id}
                href={`/services/${encodeURIComponent(s.id)}`}
                className="block border border-zinc-200 dark:border-zinc-800 rounded-md p-5 hover:border-amber transition bg-white dark:bg-[#13110e]"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <TypeChip type={s.type} />
                  <span className="font-mono text-xs tabular-nums">
                    {s.price_sats} sat
                  </span>
                </div>
                <div className="font-serif text-lg leading-tight">{s.name}</div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300 line-clamp-2">
                  {s.description}
                </p>
                <code className="block mt-3 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                  {s.endpoint}
                </code>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="font-serif text-2xl mb-4">Activity</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-zinc-200 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden">
          <Stat label="Transactions" value={stats.tx_count} />
          <Stat label="Sats earned" value={stats.sats_earned} />
          <Stat
            label="Last active"
            value={relativeTime(seller.last_active_at)}
          />
        </div>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
          Note: per-transaction history is not exposed by the registry's
          public surface; only aggregate counts are available here.
        </p>
      </section>

      <section>
        <h2 className="font-serif text-2xl mb-2">Raw data</h2>
        <p className="text-sm">
          <a
            href={`${REGISTRY_URL}/api/v1/sellers/${seller.pubkey}/stats`}
            target="_blank"
            rel="noopener"
            className="font-mono text-xs hover:text-amber underline-offset-2 hover:underline"
          >
            View on registry → /api/v1/sellers/{seller.pubkey.slice(0, 8)}…/stats
          </a>
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#fafaf7] dark:bg-[#0a0908] px-5 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="font-serif text-2xl mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function Badge({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border ${
        ok
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          : "border-zinc-300 dark:border-zinc-700 text-zinc-500"
      }`}
    >
      {children}
    </span>
  );
}
