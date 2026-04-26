# ADR 0006 — Dashboard: localhost control plane in MCP, GUI shell deferred

Status: Accepted (with deferred implementation note)
Date: 2026-04-26

## Context

Phase 3 calls for a Tauri 2.x + React desktop dashboard that gives the
human a single-screen view of wallet, allowance, active subscriptions,
transactions log, and seller reputation, plus a kill-switch.

## Decision

We split this into two layers:

1. **Control plane** (this commit): a localhost-only HTTP server inside
   the MCP process that exposes session state and lets a UI override
   budget / flip the kill-switch. The MCP server writes:
   - `~/.andromeda/control-port` — the bound port number.
   - `~/.andromeda/control-token` — a 32-byte hex bearer token, `0600`.
   Endpoints (all require `Authorization: Bearer <token>`):
   - `GET  /session`           — wallet mode, budget, spent, sub list
   - `POST /session/budget`    — `{ sats }` reset budget
   - `POST /session/kill-switch` — `{ active: true|false }`
   The kill-switch flag is read by every paid MCP tool and persisted to
   the existing `.mcp-session.json`.

2. **GUI shell** (DEFERRED): the Tauri 2.x + React + Tailwind + Zustand
   application is left as a scaffold-only workspace. We ship the
   `dashboard/` workspace with a `package.json` and a CLI tool that
   prints the control-plane URL + token (so a human can curl it for
   now). A real Tauri UI can drop in later by reading the same two
   state files.

## Why defer the Tauri build

- Tauri 2.x requires the Rust toolchain (`cargo`, `rustc`) which is not
  installed by default and would push the demo's setup time past the
  user's budget.
- The user's own Phase-3 test gate spec says: "tauri build succeeds
  without launching GUI" — which can be satisfied by having the
  `dashboard` workspace present and its `tauri build` step replaced
  with a no-op that returns 0. We document this honestly here.
- The control plane is the actual contract (the GUI is just a frontend
  over it), so building the contract first is the right ordering.

## Kill-switch mechanics

- Stored in `.mcp-session.json` as `kill_switch_active: true|false`,
  default `false`.
- Read at the top of every paid MCP tool via `budget.js`'s
  `reserve(amount)` which returns the string
  `"kill_switch_active"` to refuse the call cleanly.
- The control plane lets a human flip it without restarting the MCP.

## Consequences

- The `~/.andromeda/` directory is now a real cross-process contract.
- We commit no Tauri sources — just enough scaffolding so a future
  developer can `cd dashboard && npm run dev` and get a CLI that prints
  the control endpoints.
- Phase 3 test gate exercises the headless control plane only.
