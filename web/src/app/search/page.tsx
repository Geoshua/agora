import Link from "next/link";
import { listSellers, searchServices } from "@/lib/registry";
import { TypeChip, Tag } from "@/components/type-chip";
import { HonorStars } from "@/components/honor";

export const dynamic = "force-dynamic";

export default async function SearchPage(props: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const sp = (await props.searchParams) ?? {};
  const q = (sp.q ?? "").trim();

  const [searchRes, sellersRes] = await Promise.all([
    q ? searchServices(q) : Promise.resolve(null),
    listSellers({ limit: 500 }),
  ]);

  const sellerByPk = new Map(
    (sellersRes?.sellers ?? []).map((s) => [s.pubkey, s])
  );
  const services = searchRes?.services ?? [];

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">
          Search
        </p>
        <h1 className="font-serif text-3xl mt-1">Find a service</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">
          Full-text search over service name, description, and tags. Powered
          by the registry's SQLite FTS5 index.
        </p>
      </header>

      <form method="get" className="flex gap-2 mb-8">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="e.g. listing verification"
          className="flex-1 border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 text-base bg-white dark:bg-[#13110e]"
          autoFocus
        />
        <button
          type="submit"
          className="border border-amber text-amber rounded px-4 py-2 text-sm font-mono uppercase tracking-wider hover:bg-amber hover:text-ink transition"
        >
          Search
        </button>
      </form>

      {q && (
        <RecommendBanner q={q} />
      )}

      {!q ? (
        <p className="text-zinc-500 dark:text-zinc-400 text-sm py-8">
          Enter a query above.
        </p>
      ) : searchRes === null ? (
        <ErrorBlock />
      ) : services.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400 text-sm py-8">
          No services match "{q}". Try{" "}
          <Link
            href={`/recommend?intent=${encodeURIComponent(q)}`}
            className="text-amber hover:underline"
          >
            Recommend
          </Link>{" "}
          for semantic matching.
        </p>
      ) : (
        <>
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
            {services.length} result{services.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-3">
            {services.map((s) => {
              const seller = sellerByPk.get(s.seller_pubkey);
              return (
                <li
                  key={s.id}
                  className="border border-zinc-200 dark:border-zinc-800 rounded-md p-5 bg-white dark:bg-[#13110e]"
                >
                  <Link
                    href={`/services/${encodeURIComponent(s.id)}`}
                    className="block hover:text-amber"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <TypeChip type={s.type} />
                        <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                          {seller?.name ?? "—"}
                        </span>
                      </div>
                      <span className="font-mono text-xs tabular-nums">
                        {s.price_sats} sat
                      </span>
                    </div>
                    <div className="font-serif text-xl">{s.name}</div>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                      {s.description}
                    </p>
                  </Link>
                  <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex flex-wrap gap-1.5">
                      {s.tags.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </div>
                    <HonorStars honor={seller?.honor ?? 0} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function RecommendBanner({ q }: { q: string }) {
  return (
    <aside className="mb-8 border border-cyan/40 bg-cyan/5 rounded-md p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1">
        <p className="font-mono text-xs uppercase tracking-wider text-cyan-700 dark:text-cyan-300 mb-1">
          Tried recommend?
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-200">
          The orchestrator ranks services by intent embedding + honor +
          price-fit and shows the breakdown.
        </p>
      </div>
      <Link
        href={`/recommend?intent=${encodeURIComponent(q)}`}
        className="self-start sm:self-auto border border-cyan-500 text-cyan-700 dark:text-cyan-300 rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider hover:bg-cyan-500 hover:text-ink transition"
      >
        Recommend "{q.length > 24 ? q.slice(0, 24) + "…" : q}" →
      </Link>
    </aside>
  );
}

function ErrorBlock() {
  return (
    <div className="border border-amber/40 bg-amber/5 rounded p-6 text-sm">
      <p className="font-mono text-xs uppercase tracking-wider text-amber mb-2">
        Search failed
      </p>
      <p>The registry's search endpoint did not respond.</p>
    </div>
  );
}
