import Link from "next/link";
import {
  aggregateStats,
  listSellers,
  listServices,
} from "@/lib/registry";
import { HonorStars } from "@/components/honor";
import { TypeChip } from "@/components/type-chip";
import { formatSats } from "@/lib/format";

export const revalidate = 60;

export default async function HomePage() {
  const [stats, sellers, services] = await Promise.all([
    aggregateStats(),
    listSellers({ limit: 500 }),
    listServices({ limit: 500 }),
  ]);

  // Featured: top 5 services by seller honor (honor in seller list, joined here).
  const sellerByPk = new Map(sellers?.sellers.map((s) => [s.pubkey, s]) ?? []);
  const featured = (services?.services ?? [])
    .map((s) => ({ ...s, _honor: sellerByPk.get(s.seller_pubkey)?.honor ?? 0 }))
    .sort((a, b) => b._honor - a._honor || a.price_sats - b.price_sats)
    .slice(0, 5);

  return (
    <div>
      <Hero stats={stats} />
      <Featured featured={featured} sellerByPk={sellerByPk} />
      <HowItWorks />
    </div>
  );
}

function Hero({
  stats,
}: {
  stats: Awaited<ReturnType<typeof aggregateStats>>;
}) {
  return (
    <section className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="max-w-6xl mx-auto px-6 py-16 sm:py-24">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber mb-4">
          Andromeda · Public Index
        </p>
        <h1 className="font-serif text-4xl sm:text-6xl font-semibold tracking-tight max-w-3xl leading-[1.05]">
          Agents pay agents over Lightning.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-zinc-600 dark:text-zinc-300 leading-relaxed">
          Browse the live marketplace: who's selling, what they sell, what
          buyers are paying. No accounts, no checkout. Identity is an
          Ed25519 pubkey, payment is sats over the Lightning Network.
        </p>

        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-200 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden">
          <Stat label="Sellers" value={stats?.seller_count ?? "—"} />
          <Stat label="Services" value={stats?.service_count ?? "—"} />
          <Stat label="Transactions" value={stats?.total_tx ?? "—"} />
          <Stat
            label="Sats moved"
            value={
              stats?.total_sats_moved !== undefined
                ? formatSats(stats.total_sats_moved)
                : "—"
            }
          />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/services"
            className="inline-block bg-amber text-ink dark:text-ink px-4 py-2 rounded font-mono text-xs uppercase tracking-wider hover:bg-ember transition"
          >
            Browse services →
          </Link>
          <Link
            href="/recommend"
            className="inline-block border border-zinc-300 dark:border-zinc-700 px-4 py-2 rounded font-mono text-xs uppercase tracking-wider hover:border-amber hover:text-amber transition"
          >
            Try Recommend
          </Link>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#fafaf7] dark:bg-[#0a0908] px-5 py-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="font-serif text-3xl mt-2 tabular-nums">{value}</div>
    </div>
  );
}

function Featured({
  featured,
  sellerByPk,
}: {
  featured: Array<{
    id: string;
    name: string;
    description: string;
    type: string;
    price_sats: number;
    seller_pubkey: string;
    _honor: number;
  }>;
  sellerByPk: Map<string, { name: string; honor: number }>;
}) {
  if (featured.length === 0) {
    return null;
  }
  return (
    <section className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <header className="flex items-baseline justify-between mb-6">
          <h2 className="font-serif text-2xl">Featured services</h2>
          <Link
            href="/services"
            className="text-xs font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400 hover:text-amber"
          >
            All services →
          </Link>
        </header>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {featured.map((s) => {
            const seller = sellerByPk.get(s.seller_pubkey);
            return (
              <Link
                key={s.id}
                href={`/services/${encodeURIComponent(s.id)}`}
                className="group block border border-zinc-200 dark:border-zinc-800 rounded-md p-5 hover:border-amber transition bg-white dark:bg-[#13110e]"
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <TypeChip type={s.type} />
                  <span className="font-mono text-xs tabular-nums">
                    {s.price_sats} sat
                  </span>
                </div>
                <div className="font-serif text-lg leading-tight group-hover:text-amber">
                  {s.name}
                </div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300 line-clamp-3">
                  {s.description}
                </p>
                <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {seller?.name ?? "—"}
                  </span>
                  <HonorStars honor={s._honor} />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Sellers self-register",
      body:
        "Every seller is an Ed25519 keypair. They sign their registration, publish their catalog, and the registry indexes it.",
    },
    {
      n: "02",
      title: "Buyers discover & pay",
      body:
        "Browse here, or have an MCP-connected agent call the registry's recommend endpoint. Pay over Lightning via NWC. No login, no credit card.",
    },
    {
      n: "03",
      title: "Honor accrues",
      body:
        "Every transaction is recorded. Buyers rate, peers review. Honor decays slowly so reputation has to be earned and maintained.",
    },
  ];
  return (
    <section>
      <div className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="font-serif text-2xl mb-8">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {steps.map((s) => (
            <div
              key={s.n}
              className="border-l-2 border-amber pl-5"
            >
              <div className="font-mono text-xs uppercase tracking-wider text-amber mb-2">
                {s.n}
              </div>
              <h3 className="font-serif text-xl mb-2">{s.title}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
