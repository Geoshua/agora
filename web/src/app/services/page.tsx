import Link from "next/link";
import { listSellers, listServices } from "@/lib/registry";
import { TypeChip, Tag } from "@/components/type-chip";
import { HonorStars } from "@/components/honor";

export const revalidate = 60;
export const dynamic = "force-dynamic";

const TYPE_OPTIONS = ["", "verification", "audit", "monitoring", "dataset"];

export default async function ServicesPage(props: {
  searchParams?: Promise<{ type?: string; max_price?: string; min_honor?: string }>;
}) {
  const sp = (await props.searchParams) ?? {};
  const type = sp.type ?? "";
  const maxPrice = sp.max_price ? parseInt(sp.max_price, 10) : undefined;
  const minHonor = sp.min_honor ? parseInt(sp.min_honor, 10) : undefined;

  const [servicesRes, sellersRes] = await Promise.all([
    listServices({
      type: type || undefined,
      max_price_sats: maxPrice,
      limit: 500,
    }),
    listSellers({ limit: 500 }),
  ]);

  const sellerByPk = new Map(
    (sellersRes?.sellers ?? []).map((s) => [s.pubkey, s])
  );

  let services = servicesRes?.services ?? [];
  if (minHonor !== undefined) {
    services = services.filter(
      (s) => (sellerByPk.get(s.seller_pubkey)?.honor ?? 0) >= minHonor
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">
          Catalog
        </p>
        <h1 className="font-serif text-3xl mt-1">Services</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">
          {services.length} service{services.length === 1 ? "" : "s"} across{" "}
          {sellerByPk.size} seller{sellerByPk.size === 1 ? "" : "s"}.
        </p>
      </header>

      <div className="grid lg:grid-cols-[16rem_1fr] gap-8">
        <aside>
          <Filters type={type} maxPrice={maxPrice} minHonor={minHonor} />
        </aside>

        <section>
          {servicesRes === null ? (
            <ErrorBlock />
          ) : services.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400 text-sm py-8">
              No services match these filters.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {services.map((s) => {
                const seller = sellerByPk.get(s.seller_pubkey);
                return (
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
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-mono">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {seller?.name ?? "—"}
                      </span>
                      <span className="text-zinc-300 dark:text-zinc-700">·</span>
                      <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                        p50 {s.p50_ms}ms
                      </span>
                      <span className="ml-auto">
                        <HonorStars honor={seller?.honor ?? 0} />
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {s.tags.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Filters({
  type,
  maxPrice,
  minHonor,
}: {
  type: string;
  maxPrice?: number;
  minHonor?: number;
}) {
  return (
    <form
      method="get"
      className="border border-zinc-200 dark:border-zinc-800 rounded-md p-5 bg-white dark:bg-[#13110e] sticky top-24"
    >
      <p className="font-mono text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
        Filter
      </p>

      <label className="block text-xs font-mono uppercase tracking-wider mb-1 mt-3">
        Type
      </label>
      <select
        name="type"
        defaultValue={type}
        className="w-full border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-[#13110e]"
      >
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t || "any"}
          </option>
        ))}
      </select>

      <label className="block text-xs font-mono uppercase tracking-wider mb-1 mt-4">
        Max price (sat)
      </label>
      <input
        type="number"
        name="max_price"
        min={0}
        defaultValue={maxPrice ?? ""}
        placeholder="any"
        className="w-full border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-[#13110e]"
      />

      <label className="block text-xs font-mono uppercase tracking-wider mb-1 mt-4">
        Min honor
      </label>
      <input
        type="number"
        name="min_honor"
        min={0}
        defaultValue={minHonor ?? ""}
        placeholder="any"
        className="w-full border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-[#13110e]"
      />

      <button
        type="submit"
        className="mt-5 w-full border border-amber text-amber rounded px-3 py-2 text-xs font-mono uppercase tracking-wider hover:bg-amber hover:text-ink transition"
      >
        Apply filters
      </button>
      <Link
        href="/services"
        className="mt-2 block text-center text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-amber"
      >
        reset
      </Link>
    </form>
  );
}

function ErrorBlock() {
  return (
    <div className="border border-amber/40 bg-amber/5 rounded p-6 text-sm">
      <p className="font-mono text-xs uppercase tracking-wider text-amber mb-2">
        Registry unreachable
      </p>
      <p>Could not load services from the registry.</p>
    </div>
  );
}
