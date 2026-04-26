import Link from "next/link";
import { listSellers, listServices, sellerStats, type Seller } from "@/lib/registry";
import { HonorStars } from "@/components/honor";
import { PubkeyDisplay } from "@/components/pubkey";
import { relativeTime } from "@/lib/format";

export const revalidate = 60;
export const dynamic = "force-dynamic";

type SortKey = "honor" | "registered_at" | "tx_count";

const PAGE_SIZE = 25;

export default async function SellersPage(props: {
  searchParams?: Promise<{ sort?: string; q?: string; page?: string }>;
}) {
  const sp = (await props.searchParams) ?? {};
  const sort: SortKey =
    sp.sort === "registered_at" || sp.sort === "tx_count" ? sp.sort : "honor";
  const q = (sp.q ?? "").trim().toLowerCase();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));

  const [sellersRes, servicesRes] = await Promise.all([
    listSellers({ limit: 500 }),
    listServices({ limit: 500 }),
  ]);

  const services = servicesRes?.services ?? [];
  const serviceCountByPk = new Map<string, number>();
  for (const s of services) {
    serviceCountByPk.set(
      s.seller_pubkey,
      (serviceCountByPk.get(s.seller_pubkey) ?? 0) + 1
    );
  }

  // Pull tx counts in parallel.
  const sellersAll = sellersRes?.sellers ?? [];
  const txCounts = await Promise.all(
    sellersAll.map(async (s) => {
      const st = await sellerStats(s.pubkey);
      return [s.pubkey, st?.tx_count ?? 0] as const;
    })
  );
  const txCountByPk = new Map(txCounts);

  type Row = Seller & { service_count: number; tx_count: number };
  let rows: Row[] = sellersAll.map((s) => ({
    ...s,
    service_count: serviceCountByPk.get(s.pubkey) ?? 0,
    tx_count: txCountByPk.get(s.pubkey) ?? 0,
  }));

  if (q) {
    rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  }

  rows.sort((a, b) => {
    if (sort === "honor") return b.honor - a.honor;
    if (sort === "registered_at")
      return (
        new Date(b.registered_at).getTime() - new Date(a.registered_at).getTime()
      );
    return b.tx_count - a.tx_count;
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const slice = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <header className="mb-6 flex flex-col gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">
            Index
          </p>
          <h1 className="font-serif text-3xl mt-1">Sellers</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">
            {total} {total === 1 ? "seller" : "sellers"} registered with the
            Andromeda registry.
          </p>
        </div>
        <Toolbar sort={sort} q={q} />
      </header>

      {sellersRes === null ? (
        <ErrorBlock />
      ) : slice.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400 text-sm py-8">
          No sellers match.
        </p>
      ) : (
        <ul className="border border-zinc-200 dark:border-zinc-800 rounded-md divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-[#13110e]">
          {slice.map((s) => (
            <li key={s.pubkey} className="p-5 hover:bg-zinc-50 dark:hover:bg-[#1a1714]/60 transition">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/sellers/${s.pubkey}`}
                    className="font-serif text-xl hover:text-amber"
                  >
                    {s.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <PubkeyDisplay pubkey={s.pubkey} />
                    <span>·</span>
                    <span title={s.registered_at}>registered {relativeTime(s.registered_at)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
                  <span>
                    <span className="text-zinc-700 dark:text-zinc-200">{s.service_count}</span> service{s.service_count === 1 ? "" : "s"}
                  </span>
                  <span>
                    <span className="text-zinc-700 dark:text-zinc-200">{s.tx_count}</span> tx
                  </span>
                  <HonorStars honor={s.honor} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <Pagination page={safePage} totalPages={totalPages} sort={sort} q={q} />
      )}
    </div>
  );
}

function Toolbar({ sort, q }: { sort: SortKey; q: string }) {
  return (
    <form method="get" className="flex flex-col sm:flex-row gap-3 sm:items-center">
      <input
        type="text"
        name="q"
        defaultValue={q}
        placeholder="filter by name…"
        className="flex-1 border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 text-sm bg-white dark:bg-[#13110e]"
      />
      <select
        name="sort"
        defaultValue={sort}
        className="border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 text-sm bg-white dark:bg-[#13110e] font-mono uppercase tracking-wider text-xs"
      >
        <option value="honor">sort: honor</option>
        <option value="registered_at">sort: registered</option>
        <option value="tx_count">sort: tx count</option>
      </select>
      <button
        type="submit"
        className="border border-amber text-amber rounded px-3 py-2 text-xs font-mono uppercase tracking-wider hover:bg-amber hover:text-ink transition"
      >
        Apply
      </button>
    </form>
  );
}

function Pagination({
  page,
  totalPages,
  sort,
  q,
}: {
  page: number;
  totalPages: number;
  sort: string;
  q: string;
}) {
  const mk = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("sort", sort);
    sp.set("page", String(p));
    return `/sellers?${sp.toString()}`;
  };
  return (
    <nav className="mt-6 flex items-center justify-between text-xs font-mono uppercase tracking-wider">
      {page > 1 ? (
        <Link href={mk(page - 1)} className="hover:text-amber">
          ← prev
        </Link>
      ) : (
        <span className="text-zinc-400 dark:text-zinc-600">prev</span>
      )}
      <span>
        Page {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={mk(page + 1)} className="hover:text-amber">
          next →
        </Link>
      ) : (
        <span className="text-zinc-400 dark:text-zinc-600">next</span>
      )}
    </nav>
  );
}

function ErrorBlock() {
  return (
    <div className="border border-amber/40 bg-amber/5 rounded p-6 text-sm">
      <p className="font-mono text-xs uppercase tracking-wider text-amber mb-2">
        Registry unreachable
      </p>
      <p>
        Could not load sellers from the registry. Check that the registry is
        running on <code>{process.env.ANDROMEDA_REGISTRY_URL ?? "http://localhost:3030"}</code>.
      </p>
    </div>
  );
}
