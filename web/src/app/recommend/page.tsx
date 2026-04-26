import Link from "next/link";
import { recommend } from "@/lib/registry";
import { TypeChip } from "@/components/type-chip";
import { PubkeyDisplay } from "@/components/pubkey";

export const dynamic = "force-dynamic";

export default async function RecommendPage(props: {
  searchParams?: Promise<{
    intent?: string;
    max_price_sats?: string;
    min_honor?: string;
    type?: string;
  }>;
}) {
  const sp = (await props.searchParams) ?? {};
  const intent = (sp.intent ?? "").trim();
  const max_price_sats = sp.max_price_sats ? parseInt(sp.max_price_sats, 10) : undefined;
  const min_honor = sp.min_honor ? parseInt(sp.min_honor, 10) : undefined;
  const type = sp.type || undefined;

  const result =
    intent.length >= 2
      ? await recommend({ intent, max_price_sats, min_honor, type })
      : null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">
          Orchestrator
        </p>
        <h1 className="font-serif text-3xl mt-1">Recommend a service</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1 max-w-2xl">
          Describe what you need. The registry ranks services by{" "}
          <code className="font-mono text-xs">intent_match</code> ·{" "}
          <code className="font-mono text-xs">honor_normalized</code> ·{" "}
          <code className="font-mono text-xs">price_fit</code> and returns the
          breakdown.
        </p>
      </header>

      <form
        method="get"
        className="border border-zinc-200 dark:border-zinc-800 rounded-md p-5 bg-white dark:bg-[#13110e] mb-8"
      >
        <label className="block text-xs font-mono uppercase tracking-wider mb-1">
          Intent
        </label>
        <textarea
          name="intent"
          rows={3}
          defaultValue={intent}
          placeholder="e.g. I need to verify a hotel listing exists at the address my agent was quoted."
          className="w-full border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 text-sm bg-white dark:bg-[#13110e]"
          required
        />

        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider mb-1">
              Max price (sat)
            </label>
            <input
              type="number"
              name="max_price_sats"
              min={0}
              defaultValue={max_price_sats ?? ""}
              placeholder="any"
              className="w-full border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-[#13110e]"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider mb-1">
              Min honor
            </label>
            <input
              type="number"
              name="min_honor"
              min={0}
              defaultValue={min_honor ?? ""}
              placeholder="any"
              className="w-full border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-[#13110e]"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider mb-1">
              Type
            </label>
            <select
              name="type"
              defaultValue={type ?? ""}
              className="w-full border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-[#13110e]"
            >
              <option value="">any</option>
              <option value="verification">verification</option>
              <option value="audit">audit</option>
              <option value="monitoring">monitoring</option>
              <option value="dataset">dataset</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          className="mt-5 border border-amber bg-amber text-ink rounded px-4 py-2 text-xs font-mono uppercase tracking-wider hover:bg-ember transition"
        >
          Recommend →
        </button>
      </form>

      {!intent ? (
        <p className="text-zinc-500 dark:text-zinc-400 text-sm py-4">
          Enter an intent above to see recommendations.
        </p>
      ) : result === null ? (
        <ErrorBlock />
      ) : (
        <Results result={result} />
      )}
    </div>
  );
}

function Results({
  result,
}: {
  result: NonNullable<Awaited<ReturnType<typeof recommend>>>;
}) {
  return (
    <section>
      <header className="mb-4">
        <p className="text-xs font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {result.results.length} ranked result
          {result.results.length === 1 ? "" : "s"} · weights:{" "}
          intent_match {result.weights.intent_match} · honor{" "}
          {result.weights.honor_normalized} · price-fit {result.weights.price_fit}
        </p>
      </header>

      {result.results.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400 text-sm py-4">
          No services matched.
        </p>
      ) : (
        <ol className="space-y-3">
          {result.results.map((r, i) => (
            <li
              key={r.service_id}
              className="border border-zinc-200 dark:border-zinc-800 rounded-md p-5 bg-white dark:bg-[#13110e]"
            >
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600 tabular-nums">
                    #{i + 1}
                  </span>
                  <Link
                    href={`/services/${encodeURIComponent(r.service_id)}`}
                    className="font-serif text-xl hover:text-amber"
                  >
                    {r.name}
                  </Link>
                </div>
                <ScoreBar score={r.score} />
              </div>

              <div className="flex items-center gap-2 flex-wrap mb-3">
                <TypeChip type={r.type} />
                <span className="font-mono text-xs tabular-nums">
                  {r.price_sats} sat
                </span>
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  honor {r.honor}
                </span>
                <PubkeyDisplay pubkey={r.seller_pubkey} />
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-300 line-clamp-2 mb-3">
                {r.description}
              </p>

              <Breakdown
                intent={r.intent_match}
                honor={r.honor_normalized}
                price={r.price_fit}
              />
            </li>
          ))}
        </ol>
      )}

      {result.excluded.length > 0 && (
        <div className="mt-6 border border-zinc-200 dark:border-zinc-800 rounded-md p-4">
          <p className="font-mono text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            Excluded ({result.excluded.length})
          </p>
          <ul className="space-y-1 text-xs font-mono">
            {result.excluded.map((e) => (
              <li key={e.service_id} className="text-zinc-500 dark:text-zinc-400">
                {e.service_id} — {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score)) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
        {score.toFixed(3)}
      </span>
    </div>
  );
}

function Breakdown({
  intent,
  honor,
  price,
}: {
  intent: number;
  honor: number;
  price: number;
}) {
  const Row = ({
    label,
    value,
    weight,
  }: {
    label: string;
    value: number;
    weight: number;
  }) => (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="w-28 uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <div className="flex-1 h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <div
          className="h-full bg-cyan-500/60"
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </div>
      <span className="w-12 tabular-nums text-right">{value.toFixed(3)}</span>
      <span className="w-12 tabular-nums text-right text-zinc-400 dark:text-zinc-600">
        ×{weight}
      </span>
    </div>
  );
  return (
    <div className="space-y-1.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      <Row label="intent_match" value={intent} weight={0.6} />
      <Row label="honor" value={honor} weight={0.2} />
      <Row label="price_fit" value={price} weight={0.2} />
    </div>
  );
}

function ErrorBlock() {
  return (
    <div className="border border-amber/40 bg-amber/5 rounded p-6 text-sm">
      <p className="font-mono text-xs uppercase tracking-wider text-amber mb-2">
        Recommend failed
      </p>
      <p>The registry's orchestrator endpoint did not respond.</p>
    </div>
  );
}
