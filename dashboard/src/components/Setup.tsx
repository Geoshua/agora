import React from "react";
import { useConfigStore } from "../lib/store";
import { api } from "../lib/controlPlane";

// First-run setup. The user pastes the port (from ~/.andromeda/control-port)
// and the token (from ~/.andromeda/control-token). We try /healthz before
// saving so an obviously-wrong config is caught early.
export function Setup() {
  const setConfig = useConfigStore((s) => s.setConfig);
  const [port, setPort] = React.useState("");
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function tryConnect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const baseUrl = `http://127.0.0.1:${port.trim()}`;
      await api.healthz({ baseUrl, token: token.trim() });
      // /healthz doesn't validate the token; do a real authed call too.
      const r = await fetch(`${baseUrl}/session`, { headers: { authorization: `Bearer ${token.trim()}` } });
      if (!r.ok) throw new Error(`auth failed (status ${r.status}); double-check the token`);
      setConfig({ baseUrl, token: token.trim() });
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Andromeda Dashboard</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Connect to the local MCP control plane. Read the port from{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">~/.andromeda/control-port</code>{" "}
        and the token from{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">~/.andromeda/control-token</code>.
      </p>
      <form onSubmit={tryConnect} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">Port</span>
          <input
            value={port} onChange={(e) => setPort(e.target.value)}
            inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 53219"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">Token (Bearer)</span>
          <input
            value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="64-char hex"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs focus:border-zinc-500 focus:outline-none"
            required
          />
        </label>
        {error && <p className="rounded-md bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</p>}
        <button
          type="submit" disabled={busy}
          className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </form>
    </div>
  );
}
