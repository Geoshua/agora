# ADR 0011 — Dashboard implementation: Vite SPA + control-plane proxy

Status: Accepted
Date: 2026-04-26

## Context

ADR 0006 deferred the dashboard GUI shell on the grounds that Tauri 2.x
requires a Rust toolchain and would have pushed the demo's setup time
past budget. The headless control plane that lives inside the MCP
server (random localhost port, bearer-token auth) was completed and is
the actual contract a UI would speak to.

Phase 3-UI now picks up where ADR 0006 left off. We need a single-screen
dashboard that surfaces five concerns:

1. Wallet (balance + top-up entry-point + recent transactions)
2. Allowance (daily cap, per-call cap, kill-switch)
3. Active subscriptions (with cancel)
4. Local transaction log
5. Sellers I've used

The user can run this either as a regular browser tab against `vite
dev` or, eventually, wrapped in a Tauri 2.x window. Cargo is not
guaranteed to be on developer machines.

## Decision

### 1. SPA over Vite is the canonical target; Tauri is a thin wrap

We ship the dashboard as a **Vite 5 + React 18 + TypeScript** SPA in
`dashboard/`. The same build is what a Tauri 2.x shell would load —
Tauri merely wraps the dev server (or the built `dist/`) in a native
window. This means:

- The UI runs identically in `vite dev` and inside Tauri.
- Developers without `cargo` can still demo the dashboard by running
  `npm run dashboard:dev` (port 5173).
- Adding the Tauri wrap later is a `cargo install tauri-cli && npm run
  tauri init` away — no code in the SPA changes.

We considered (and rejected) Tauri-only: it would force a Rust
toolchain on every contributor, contradict working principle 1 (mock
mode must keep working with default tooling), and make CI heavier than
the test gate needs.

### 2. CORS scope: `http://localhost:5173` only, no wildcard

The control plane previously accepted same-origin requests only (it
was curled or hit by the MCP itself). The dashboard SPA is a separate
origin (`http://localhost:5173` in dev, `tauri://localhost` later), so
CORS is required.

We allow **exactly one** origin: `http://localhost:5173`. We do NOT use
`Access-Control-Allow-Origin: *` because the bearer token flows through
this origin and any malicious page on a developer's machine could
otherwise read kill-switch / budget state. When the Tauri build ships
we'll add `tauri://localhost` to the allow-list — additive, single
constant in `mcp/control-plane.js`.

A test in the Phase 3-UI gate verifies that a preflight from
`http://evil.com` is rejected.

### 3. Control-plane proxies registry data; UI never talks to registry directly

The natural alternative was: let the SPA fetch
`http://localhost:3030/api/v1/sellers` directly. We rejected this for
three reasons:

- **Single auth surface.** Every dashboard call goes through one bearer
  token. If we let the UI talk to the registry directly, a user
  flipping the kill-switch wouldn't actually stop a runaway tab from
  reading registry data — and worse, the UI would have to learn a
  second auth model.
- **Kill-switch enforceability.** When the kill-switch is on, the
  control plane can refuse to proxy registry calls (future work) so
  the human's "halt" actually halts the dashboard's external chatter.
  Direct calls would bypass this.
- **Origin firewall.** The registry is meant to be public; when we
  later run the registry on a remote host, the UI's CORS config doesn't
  have to change. Only `mcp/control-plane.js` learns the new URL.

So we add five new HTTP endpoints to the control plane:

| Method | Path                              | Source                              |
|--------|-----------------------------------|-------------------------------------|
| GET    | `/balance`                        | NWC balance via `lumen-client.js`   |
| GET    | `/transactions`                   | `~/.andromeda/transactions.log`     |
| GET    | `/subscriptions`                  | aggregates `subs.listAll()` + per-sub balance from each seller |
| POST   | `/subscriptions/:id/cancel`       | proxies to seller cancel endpoint   |
| GET    | `/sellers`                        | proxies to registry `GET /api/v1/sellers` |

All require the existing Bearer token. All are localhost-only. None of
them is an MCP tool — they're HTTP-only and additive (working principle
4: existing endpoints + MCP tool shapes are FROZEN).

### 4. State store: Zustand, one store per concern

The SPA uses **Zustand** (already mandated by the brief). One store per
concern (wallet, allowance, subscriptions, transactions, sellers) keeps
each section's state independent and avoids the classic single-blob
problem where a single network failure invalidates the whole UI.

### 5. Styling: Tailwind, no design system

Tailwind (also mandated). One file, utility classes, no custom theme.
The UI is desk-app-style, not marketing.

## Consequences

- The dashboard becomes a real SPA, replacing the CLI placeholder. The
  CLI is preserved as `npm run dashboard:cli` for quick session probes.
- The control plane is now the single network egress for the UI, which
  simplifies kill-switch story and CORS story.
- Tauri remains optional. If/when cargo is installed, a one-time `npm
  run tauri init` wraps the existing SPA. Until then, `dashboard:tauri:build`
  prints a friendly message and exits 0 to keep CI green.
- New transaction log file: `~/.andromeda/transactions.log` (append-only
  JSONL). The control plane creates it on first read if absent. The MCP
  server appends to it on every settled paid call (additive — does not
  invalidate `.mcp-session.json`).
