# ADR 0012 — Public web index

Status: Accepted
Date: 2026-04-26

## Context

Phases 0-6 ship the Andromeda registry, three sellers, the MCP buyer, and a
dashboard control plane. The registry's HTTP surface is fully public and
machine-readable, but there is no human-friendly browsing experience.

Phase 7 (originally optional) builds a read-only web index at `web/` so a
curious human can land on the marketplace, see who's selling what, and
read service detail pages without inspecting JSON in DevTools. The site
must not duplicate registry state (principle 3) and must not introduce
any write paths (principle 4).

## Decision

**Framework: Next.js 16 (App Router) with React Server Components.**

Reasons:

1. The registry itself is Next.js 16. Reusing the same toolchain keeps
   the repo's mental model coherent — every HTTP-facing workspace is a
   Next.js app, every test gate already knows how to spawn `next dev`.
2. RSC + server-side `fetch` against `ANDROMEDA_REGISTRY_URL` means
   pages render fully on the server — no JSON-API client, no hydration
   overhead, no double round-trip. The browser receives plain HTML.
3. A plain-HTML approach (e.g. `static-html-export`) was considered but
   rejected: registry data changes on every transaction, and we want a
   live view, not a snapshot rebuild.
4. A SPA (Vite + React Query) was considered and rejected: no auth, no
   mutations, no client interactivity worth the bundle size. There is
   exactly one tiny client-island (the dark-mode toggle) and even that
   could be CSS-only.

**Scope: 7 pages (not the original 3).**

The original phase-7 brief listed `/`, `/sellers/:pubkey`, and
`/services/:id`. We expanded to 7:

- `/` — homepage with hero, headline stats, featured services, "how it
  works" — needed to make the index actually findable.
- `/sellers` and `/services` — the lists. Without index pages, a visitor
  has no way to discover a `:pubkey` or `:id`. The detail-only spec was
  unworkable in practice.
- `/search` — surfaces the registry's existing FTS5 search endpoint.
  Pure delegate; trivial to build.
- `/recommend` — surfaces the orchestrator's score breakdown. The
  registry already returns explainable scores; not exposing them in the
  UI would waste the work of phase 4.

The two detail pages (`/sellers/[pubkey]`, `/services/[id]`) match the
original spec verbatim. We did not add admin pages, dashboards, or any
authenticated views — those belong in `dashboard/`.

This is additive, not scope creep: every page maps 1:1 to an existing
public registry endpoint. No new registry endpoints were added.

**Caching: `revalidate = 60` on list pages, `no-store` on detail
fetches.**

List pages (`/`, `/sellers`, `/services`) are fine 60s stale — they
move slowly. Detail pages and `/search`/`/recommend` use `no-store`
so a visitor following a link from the registry CLI sees fresh data.
This is Next 16's default `fetch()` cache control set explicitly.

**robots.txt + sitemap: present, permissive.**

The site is read-only, public, and intended to be indexed once
deployed. We ship a static `public/robots.txt` allowing all and a
dynamic `app/sitemap.ts` that enumerates `/`, `/sellers`,
`/services`, `/search`, `/recommend` plus every seller and service
detail page from the registry. Indexing of seller-pubkey URLs is
accepted as a feature, not a leak — pubkeys are public identity by
design (ADR 0001).

**Port: 3300.**

3000 = provider, 3030 = registry, 3100 = market-monitor, 3200 =
dataset-seller. 3300 keeps the family pattern (round hundreds) and
avoids 3001/3002 collision with anything `npm` might pick by default.

**No external icon library.** All icons inline as `<svg>`, kept tiny.
Tailwind only for styling. No third-party UI kit. The only runtime
dependencies are `next`, `react`, `react-dom`. No state management,
no data fetcher, no form library — nothing to mutate.

## Consequences

- Adding a new registry endpoint is "extend a typed fetcher in
  `web/src/lib/registry.ts` + add a page". No client API layer to
  touch.
- The dark-mode toggle is the only non-trivial client-side bit. It
  uses `localStorage` + a tiny inline `<script>` in `<head>` to avoid
  flash-of-wrong-theme. This is the only client JS in the bundle.
- No automated retry on registry-down. A page that can't reach
  `http://localhost:3030` shows a friendly error block. Operators run
  the registry; the web index is best-effort.
- Future analytics, OG-image generation, RSS, JSON-feed: trivial to
  add in this shape. We do not add them now.
