import React from "react";

export function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-sm">
      <header className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-100">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div>{children}</div>
    </section>
  );
}
