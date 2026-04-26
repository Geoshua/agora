import React from "react";
import { useConfigStore } from "./lib/store";
import { Setup } from "./components/Setup";
import { Wallet } from "./components/Wallet";
import { Allowance } from "./components/Allowance";
import { Subscriptions } from "./components/Subscriptions";
import { Transactions } from "./components/Transactions";
import { SellersUsed } from "./components/SellersUsed";

// One-screen, sectioned dashboard.
export default function App() {
  const config = useConfigStore((s) => s.config);
  const clear = useConfigStore((s) => s.clear);

  if (!config) return <Setup />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
            <h1 className="text-sm font-bold tracking-wide">Andromeda</h1>
            <span className="text-[11px] text-zinc-500 font-mono">{config.baseUrl}</span>
          </div>
          <button
            onClick={() => { if (confirm("Forget the control-plane connection?")) clear(); }}
            className="text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            Disconnect
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Wallet />
          <Allowance />
        </div>
        <Subscriptions />
        <Transactions />
        <SellersUsed />
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-6 text-[11px] text-zinc-500">
        Andromeda Phase 3-UI · single localhost client · ADR 0011
      </footer>
    </div>
  );
}
