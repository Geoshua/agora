import Link from "next/link";
import { notFound } from "next/navigation";
import {
  findServiceById,
  listSellers,
  recommend,
  REGISTRY_URL,
} from "@/lib/registry";
import { TypeChip, Tag } from "@/components/type-chip";
import { HonorStars } from "@/components/honor";
import { PubkeyDisplay } from "@/components/pubkey";
import { CopyButton } from "@/components/copy-button";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ServiceDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await props.params;
  const id = decodeURIComponent(rawId);

  const [service, sellers] = await Promise.all([
    findServiceById(id),
    listSellers({ limit: 500 }),
  ]);
  if (!service) notFound();

  const seller = (sellers?.sellers ?? []).find(
    (s) => s.pubkey === service.seller_pubkey
  );

  // Top 3 similar services via recommend, excluding this one.
  const rec = await recommend({ intent: `${service.name}\n${service.description}` });
  const similar = (rec?.results ?? [])
    .filter((r) => r.service_id !== service.id)
    .slice(0, 3);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link
        href="/services"
        className="font-mono text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 hover:text-amber"
      >
        ← all services
      </Link>

      <header className="mt-4 mb-8">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <TypeChip type={service.type} />
          <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            updated {relativeTime(service.updated_at)}
          </span>
        </div>
        <h1 className="font-serif text-4xl leading-tight">{service.name}</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-300 max-w-3xl text-lg leading-relaxed">
          {service.description}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {service.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      </header>

      <div className="grid md:grid-cols-[1fr_18rem] gap-8">
        <div>
          <section className="mb-8">
            <h2 className="font-serif text-2xl mb-3">Endpoint</h2>
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-md p-4 bg-white dark:bg-[#13110e]">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <code className="font-mono text-sm break-all">
                  {service.endpoint}
                </code>
                <CopyButton value={service.endpoint} label="copy URL" />
              </div>
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                Agent-callable. Requires L402 / NWC payment to access. The
                public web index is read-only — paying happens via your MCP
                client or a buyer agent.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="font-serif text-2xl mb-3">Schema</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              The registry exposes name, description, type, tags, price, p50,
              and endpoint. Per-service request/response schemas are not
              indexed centrally — fetch the seller's <code className="font-mono text-xs">/api/v1/discovery</code> for those.
            </p>
            <div className="mt-3">
              <a
                href={`${seller?.url ?? ""}/api/v1/discovery`}
                target="_blank"
                rel="noopener"
                className="font-mono text-xs hover:text-amber underline-offset-2 hover:underline"
              >
                {seller?.url ?? ""}/api/v1/discovery →
              </a>
            </div>
          </section>

          {similar.length > 0 && (
            <section className="mb-8">
              <h2 className="font-serif text-2xl mb-3">Similar services</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 font-mono">
                Top 3 by intent_match via /api/v1/orchestrator/recommend
              </p>
              <div className="space-y-2">
                {similar.map((r) => (
                  <Link
                    key={r.service_id}
                    href={`/services/${encodeURIComponent(r.service_id)}`}
                    className="block border border-zinc-200 dark:border-zinc-800 rounded-md p-4 hover:border-amber transition bg-white dark:bg-[#13110e]"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <TypeChip type={r.type} />
                      <span className="font-mono text-xs tabular-nums">
                        {r.price_sats} sat
                      </span>
                    </div>
                    <div className="font-serif text-base leading-tight">
                      {r.name}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      <div>
                        intent <span className="text-zinc-700 dark:text-zinc-200 tabular-nums">{r.intent_match.toFixed(3)}</span>
                      </div>
                      <div>
                        honor <span className="text-zinc-700 dark:text-zinc-200 tabular-nums">{r.honor_normalized.toFixed(2)}</span>
                      </div>
                      <div>
                        price-fit <span className="text-zinc-700 dark:text-zinc-200 tabular-nums">{r.price_fit.toFixed(2)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside>
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-md p-5 bg-white dark:bg-[#13110e] sticky top-24">
            <p className="font-mono text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
              Price
            </p>
            <div className="font-serif text-3xl tabular-nums">
              {service.price_sats}
              <span className="text-base text-zinc-500 dark:text-zinc-400 ml-1">
                sat
              </span>
            </div>
            <div className="mt-1 text-xs font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
              p50 {service.p50_ms}ms
            </div>

            <div className="my-5 border-t border-zinc-200 dark:border-zinc-800" />

            <p className="font-mono text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
              Sold by
            </p>
            {seller ? (
              <div>
                <Link
                  href={`/sellers/${seller.pubkey}`}
                  className="font-serif text-lg hover:text-amber"
                >
                  {seller.name}
                </Link>
                <div className="mt-1 text-xs">
                  <PubkeyDisplay pubkey={seller.pubkey} />
                </div>
                <div className="mt-3">
                  <HonorStars honor={seller.honor} />
                </div>
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-3">
                  {seller.description}
                </p>
              </div>
            ) : (
              <span className="text-zinc-500 dark:text-zinc-400 text-sm">—</span>
            )}

            <div className="my-5 border-t border-zinc-200 dark:border-zinc-800" />

            <p className="font-mono text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
              Service ID
            </p>
            <code className="font-mono text-[11px] block break-all text-zinc-600 dark:text-zinc-300">
              {service.id}
            </code>
            <a
              href={`${REGISTRY_URL}/api/v1/services?type=${service.type}`}
              target="_blank"
              rel="noopener"
              className="mt-3 block text-[11px] font-mono hover:text-amber underline-offset-2 hover:underline"
            >
              View on registry →
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
