"use client";

import { useState } from "react";

export function CopyButton({ value, label = "copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function onClick() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border border-zinc-300 dark:border-zinc-700 rounded hover:border-amber hover:text-amber transition"
      aria-label={`Copy ${label}`}
    >
      {copied ? "copied" : label}
    </button>
  );
}
