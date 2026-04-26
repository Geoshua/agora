import React from "react";
import { Section } from "./Section";
import { useSessionStore } from "../lib/store";

// `~/.andromeda/config.json` is the persistence target the brief calls
// out for the slider values. Right now budget is a single number on the
// MCP side (.mcp-session.json), but per-call max + the slider state are
// dashboard-only preferences. We persist them locally; the MCP picks up
// MAX_PRICE_SATS from env, so a future control-plane endpoint can sync
// these (additive, ADR 0011).
const LS_KEY = "andromeda.allowance";

interface Allowance { dailyCapSats: number; perCallMaxSats: number; }
function loadLocal(): Allowance {
  try {
    const r = JSON.parse(localStorage.getItem(LS_KEY) ?? "");
    if (typeof r?.dailyCapSats === "number" && typeof r?.perCallMaxSats === "number") return r;
  } catch {}
  return { dailyCapSats: 5000, perCallMaxSats: 1000 };
}
function saveLocal(a: Allowance) { localStorage.setItem(LS_KEY, JSON.stringify(a)); }

export function Allowance() {
  const { session, refresh, setBudget, setKillSwitch } = useSessionStore();
  const [allowance, setAllowance] = React.useState<Allowance>(loadLocal);

  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => { saveLocal(allowance); }, [allowance]);

  const kill = !!session?.kill_switch_active;
  const spent = session?.budget?.spent_sats ?? 0;
  const remaining = session?.budget?.remaining_sats ?? 0;
  const cap = session?.budget?.budget_sats ?? allowance.dailyCapSats;
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;

  return (
    <Section
      title="Allowance"
      subtitle="Daily cap, per-call max, kill-switch"
    >
      <div className="space-y-5">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
            <span>Daily cap</span>
            <span className="font-mono text-zinc-200">{allowance.dailyCapSats.toLocaleString()} sat</span>
          </div>
          <input
            type="range" min={500} max={50000} step={500}
            value={allowance.dailyCapSats}
            onChange={(e) => setAllowance({ ...allowance, dailyCapSats: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void setBudget(allowance.dailyCapSats)}
              className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-800"
            >
              Apply (resets spent)
            </button>
            <div className="ml-auto h-1.5 w-40 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] tabular-nums text-zinc-400">
              {spent.toLocaleString()} / {cap.toLocaleString()} ({remaining.toLocaleString()} left)
            </span>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
            <span>Per-call max</span>
            <span className="font-mono text-zinc-200">{allowance.perCallMaxSats.toLocaleString()} sat</span>
          </div>
          <input
            type="range" min={100} max={10000} step={100}
            value={allowance.perCallMaxSats}
            onChange={(e) => setAllowance({ ...allowance, perCallMaxSats: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
          <p className="mt-1 text-[11px] text-zinc-500">
            Stored locally. The MCP enforces <code>MAX_PRICE_SATS</code> from env;
            this slider tells the dashboard what to surface.
          </p>
        </div>

        <div className="rounded-lg border border-red-900/40 bg-red-950/30 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-red-200">Kill switch</div>
              <div className="text-[11px] text-red-300/80">
                When ON, every paid MCP tool refuses with <code>kill_switch_active</code>.
              </div>
            </div>
            <button
              onClick={() => void setKillSwitch(!kill)}
              className={`rounded-md px-4 py-2 text-sm font-bold uppercase tracking-wider transition ${
                kill ? "bg-red-600 text-white hover:bg-red-500"
                     : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              }`}
            >
              {kill ? "ENGAGED" : "Disarmed"}
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}
