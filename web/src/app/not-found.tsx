import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">
        404
      </p>
      <h1 className="font-serif text-5xl mt-2">Not in the registry.</h1>
      <p className="mt-4 text-zinc-600 dark:text-zinc-300 max-w-xl mx-auto">
        The seller pubkey or service id you requested is not in the
        Andromeda registry. It may have been removed, or never existed.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link
          href="/sellers"
          className="border border-zinc-300 dark:border-zinc-700 px-4 py-2 rounded font-mono text-xs uppercase tracking-wider hover:border-amber hover:text-amber transition"
        >
          Browse sellers
        </Link>
        <Link
          href="/services"
          className="border border-zinc-300 dark:border-zinc-700 px-4 py-2 rounded font-mono text-xs uppercase tracking-wider hover:border-amber hover:text-amber transition"
        >
          Browse services
        </Link>
      </div>
    </div>
  );
}
