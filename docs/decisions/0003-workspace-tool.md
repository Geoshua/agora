# ADR 0003 — Workspace tool: npm workspaces

Status: Accepted
Date: 2026-04-26

## Context

Andromeda spans many packages: `provider/`, `buyer/`, `mcp/`,
`registry/`, `dashboard/`, `agents/market-monitor/`,
`agents/dataset-seller/`, `packages/andromeda-core/`, `web/`. We need a
monorepo tool.

## Decision

Use **npm workspaces** (built into npm 7+). No pnpm, no yarn, no nx, no
turborepo.

## Reasoning

- Already implicit (root `package.json` defines workspace-style scripts).
- Zero extra dependency.
- Node 20.x ships with npm 10 which has solid workspace support.
- The existing `npm run install:all` script can keep working with minor
  modification.
- We are not at the scale where build-graph caching (turbo/nx) pays for
  itself.

## Consequences

- Root `package.json` adds a `workspaces` array.
- Each workspace directory has its own `package.json` with `"private":
  true`.
- Cross-workspace imports use the workspace's own `name` field (e.g.
  `@andromeda/core`).
