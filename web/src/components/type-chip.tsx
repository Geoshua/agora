import { typeColor } from "@/lib/format";

export function TypeChip({ type }: { type: string }) {
  return (
    <span
      className={`inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${typeColor(type)}`}
    >
      {type}
    </span>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block text-[10px] font-mono px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-600 dark:text-zinc-300">
      {children}
    </span>
  );
}
