# Agora — agents pay agents over Lightning ⚡

> **Brand history.** The repo's npm root name is still `lumen` (kept for
> workspace determinism). The public brand went LUMEN → Andromeda
> (ADR 0002) → **Agora** (ADR 0013). Canonical names today are `agora_*`
> MCP tools, `AGORA_*` env vars, and `X-Agora-*` HTTP headers.
> `andromeda_*` and (for the original 7) `lumen_*` continue to resolve as
> deprecated aliases. The env-var resolution chain reads
> `AGORA_*` → `ANDROMEDA_*` → `LUMEN_*`.

A working demo built for **SPIRAL × Hack-Nation Challenge 02**, then
extended into a small marketplace.

Agora is a Lightning-paywalled marketplace that **AI agents discover,
pay, and use other agents' services**. Identity is an Ed25519 public
key — no accounts, no email, no API keys, no checkout. Mock mode is
the default; real-mode Lightning is opt-in via NWC.

```
                   ┌─────────────────────────┐
                   │  Registry (port 3030)   │  sellers + tx ledger + reviews
                   │  Next.js 16 + SQLite    │
                   └────┬───────────────┬────┘
              register / record-tx     │ search / recommend
                        │              │
   ┌──────────────┐ ┌───┴──────────┐ ┌─┴────────────┐
   │ Provider     │ │ Market-      │ │ Dataset-     │   sellers
   │ vision-      │ │ monitor      │ │ seller       │
   │ oracle-3     │ │ (3100)       │ │ (3200)       │
   │ (3000)       │ │              │ │              │
   └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
          │                │                │
          └────────────────┴────────────────┘
                           ▲ HTTP + Lightning (NWC)
                           │
              ┌────────────┴────────────┐
              │  PayMyAgent (mcp/)      │  buyer-side, per host
              │  budget + kill-switch   │  + localhost control plane
              └────────┬─────────┬──────┘
                       │ stdio   │ 127.0.0.1 HTTP + Bearer
              ┌────────┴───┐ ┌───┴──────────────┐
              │ Claude /   │ │ Dashboard SPA    │  Wallet · Allowance ·
              │ Cursor /   │ │ (Vite, port 5173)│  Subs · Txs · Sellers
              │ Code       │ └──────────────────┘
              └────────────┘

         ┌──────────────────────────────────┐
         │  Public web index (port 3300)    │  read-only browser-facing
         │  Next.js 16 RSC, no auth         │  surface over the registry
         └──────────────────────────────────┘
```

Five components, each with one job:

| Component               | What it owns                                          |
|-------------------------|-------------------------------------------------------|
| **Registry** (`registry/`) | Seller catalog, transaction ledger, reviews, orchestrator. Port 3030. |
| **Providers** (`provider/`, `agents/market-monitor/`, `agents/dataset-seller/`) | The actual paid services. Each owns its own SQLite + wallet. |
| **MCP server** (`mcp/`) — *PayMyAgent* | Buyer-side stdio server. Gives Claude / Cursor / Code a budget, a goal, and a wallet. |
| **Dashboard SPA** (`dashboard/`) | Local human override: kill-switch, allowance, tx log, active subs. Port 5173. |
| **Public web index** (`web/`) | Read-only browse over the registry. Port 3300. |

---

## What ships (8 phases)

| Phase | Deliverable | Tests |
|-------|-------------|-------|
| **0**     | Shared `@agora/core` package: Ed25519 crypto, signed-request (3 header families), L402 macaroon, types, defaults, env-fallback helper, state-dir helper. | `test:phase0` · 12/12 |
| **1**     | Multi-seller registry (Next.js 16 + SQLite + FTS5). Provider self-registers, fires-and-forgets tx records. | `test:phase1b` · 16/16 |
| **2**     | Subscription primitives + `agents/market-monitor` (50 sat/event GHSA advisories). | `test:phase2` · 12/12 |
| **3**     | Localhost control plane in MCP (random port, bearer-token auth). Kill-switch and budget endpoints. | `test:phase3` · 12/12 |
| **3-UI**  | Dashboard SPA (Vite + React + TS + Tailwind + Zustand) with five sections, all behind the control plane. | `test:phase3-ui` · 16/16 |
| **4**     | Orchestrator (`POST /api/v1/orchestrator/recommend`): explainable score = 0.6×intent_match + 0.2×honor + 0.2×price_fit. | `test:phase4` · 11/11 |
| **5**     | Honor + peer review + slashing. Buyer ratings (30-day tx gate), blind-random reviewer pick, 95/5 escrow split, 90-day decay. | `test:phase5` · 16/16 |
| **6**     | `agents/dataset-seller` (NOAA PNW 2015–25, 5000 sat). Platform fee field on every settled tx (default 200 bps). | `test:phase6` · 10/10 |
| **7**     | Public web index (Next.js 16 RSC, 7 pages, sitemap + robots, port 3300). | `test:phase7` · 14/14 |
| Legacy | Original LUMEN single-provider gate. | `test:mcp` · 12/12 |

---

## Quick start

```bash
# 1. Install all workspaces
npm install

# 2. Build the shared core (dist/ is gitignored, so this is required)
cd packages/agora-core && npx tsc -p tsconfig.json && cd ../..
```

Then bring services up — each in its own terminal:

```bash
npm run registry      # http://localhost:3030  (catalog + ledger + reviews)
npm run provider      # http://localhost:3000  (vision-oracle-3 — listing-verify, order-receipt)
npm run monitor       # http://localhost:3100  (market-monitor — GHSA subscriptions)
npm run datasets      # http://localhost:3200  (dataset-seller — NOAA PNW, 5000 sat)
npm run web           # http://localhost:3300  (public web index, RSC)
npm run mcp           # writes ~/.agora/control-port + control-token
npm run dashboard     # http://localhost:5173  (dashboard SPA, talks to MCP control plane)
```

Or for the original single-provider M1 demo (no registry needed):

```bash
npm run demo          # single-service buyer flow
npm run demo:multi    # listing-verify → order-receipt on one wallet
```

Mock mode is the default everywhere — fake invoices, deterministic
preimages, zero sats moved. Flip to real Lightning via NWC (see below).

---

## Endpoints (short)

For the full endpoint inventory across all services, see
[`docs/BUILD-SUMMARY.md`](docs/BUILD-SUMMARY.md).

| Service          | Port | Highlights                                                   |
|------------------|-----:|--------------------------------------------------------------|
| Provider         | 3000 | `/api/v1/listing-verify` 240 sat, `/api/v1/order-receipt` 120 sat, `/api/v1/discovery`, `/api/v1/subscribe`. Frozen + additive only. |
| Registry         | 3030 | `/api/v1/sellers/register`, `/api/v1/services/search`, `/api/v1/transactions/record`, `/api/v1/orchestrator/recommend`, review + slashing surface, `/api/v1/admin/decay`. |
| Market-monitor   | 3100 | `subscribe` / `topup` / `cancel` / `alerts` (GHSA, 50 sat/event). |
| Dataset-seller   | 3200 | `purchase` / signed download URL, `preview`. NOAA PNW 5000 sat. |
| Web index        | 3300 | `/`, `/sellers`, `/sellers/:pubkey`, `/services`, `/services/:id`, `/search?q=`, `/recommend?intent=`, sitemap, robots. |
| MCP control plane| random / 127.0.0.1 | `/healthz`, `/session`, `/session/budget`, `/session/kill-switch`, `/events` (SSE), `/balance`, `/transactions`, `/subscriptions`, `/subscriptions/:id/cancel`, `/sellers`. |

Every signed write accepts the `X-Agora-*` header family (canonical),
with `X-Andromeda-*` and `X-Lumen-*` accepted as deprecated aliases on
incoming. Outgoing requests emit only `X-Agora-*`.

---

## MCP tools

23 canonical `agora_*` tools. Every one has an `andromeda_*` deprecated
alias; the original 7 (status, discover, balance, set_budget,
verify_listing, file_receipt, fetch_receipt) also keep their `lumen_*`
alias. **37 registered names → 23 unique handlers.**

| Canonical                              | Cost           | What it does |
|----------------------------------------|----------------|--------------|
| `agora_status`                         | free           | Wallet mode, budget, registry health, identity |
| `agora_discover` / `agora_discover_all`| free           | Connected provider's catalogue / multi-seller view |
| `agora_balance`                        | free           | NWC wallet balance |
| `agora_set_budget`                     | free           | Reset per-session sat cap |
| `agora_verify_listing`                 | ~240 sat       | OSM-geocoded listing verification |
| `agora_file_receipt`                   | ~120 sat       | Signed delivery receipt |
| `agora_fetch_receipt`                  | free           | Replay a previously-paid receipt |
| `agora_search_services` / `agora_list_sellers` | free   | Registry FTS5 + paginated lists |
| `agora_recommend`                      | free           | Orchestrator with explainable score breakdown |
| `agora_subscribe` / `agora_topup_subscription` | mock-deposit | Open / top up a sub (mock-trust deposit) |
| `agora_list_subscriptions` / `agora_check_alerts` | free | Local sub state + new alerts |
| `agora_cancel_subscription`            | refund (mock)  | Cancel + balance refund |
| `agora_rate_seller`                    | free (signed)  | 30-day tx gate enforced server-side |
| `agora_request_review` / `agora_submit_review` / `agora_set_reviewer_availability` / `agora_check_review_assignments` | various | Phase-5 peer review |
| `agora_browse_datasets` / `agora_list_datasets` | free  | Browse + list-purchased |
| `agora_purchase_dataset`               | 5000 sat       | NOAA PNW dataset (mock-mode only — real-mode is wired but the MCP path returns "not implemented" today) |

See [`PAYMYAGENT.md`](PAYMYAGENT.md) for the 5-minute Claude Desktop
install, the budget-guardrail story, and a fuller tool table.

---

## Dashboard SPA (local UI)

A single-screen browser app for the human running the buyer agent.
Talks **only** to the MCP control plane on `127.0.0.1` — it never
touches the registry directly. Bearer-token auth, CORS allow-list of
`http://localhost:5173` only.

```bash
npm run mcp           # writes ~/.agora/control-port + control-token
npm run dashboard     # http://localhost:5173
```

On first load, paste the port (`~/.agora/control-port`) and bearer
token (`~/.agora/control-token`); both are cached in `localStorage`.
If you have a legacy `~/.andromeda/` from the previous rebrand, the MCP
copies it forward on first start (one-shot, marker file dropped, old
dir kept — ADR 0013).

Sections: **Wallet** (NWC balance, top-up, last 10 txs) · **Allowance**
(daily/per-call sliders, kill-switch) · **Active subscriptions**
(runway estimate + cancel) · **Transactions** (`~/.agora/transactions.log`,
JSONL) · **Sellers I've used** (txs grouped by seller).

A Tauri shell is wired but optional — `npm run dashboard:tauri:build`
delegates to the Tauri CLI when `cargo` is on PATH and prints
install instructions otherwise. ADR 0011.

A CLI placeholder remains as `npm run dashboard:cli` for quick session
probes.

---

## Going live on Lightning (real sats)

Three things you do; two flags I flip.

### Step 1 · Get an Alby Hub account (~3 min)

Sign up at <https://albyhub.com/>. Top up with **5,000 sats** (~$3.30)
via the built-in "Buy Bitcoin" button — covers ~20 demo runs.

### Step 2 · Create NWC connection strings

In Alby Hub: **Apps → Connect a new app**, twice (or three times if
you want a separate `agora-mcp` wallet for PayMyAgent).

| App name           | Permissions                       | Paste into                          |
|--------------------|-----------------------------------|-------------------------------------|
| `agora-provider`   | `make_invoice, lookup_invoice`    | `provider/.env.local` → `NWC_URL=`  |
| `agora-buyer`      | `pay_invoice`                     | `buyer/.env` → `NWC_URL=`           |
| `agora-mcp` *(opt)*| `pay_invoice`                     | `mcp/.env` → `NWC_URL=`             |

Each gives you a `nostr+walletconnect://…` string.

> Existing `provider/.env.local` files containing
> `ANDROMEDA_PROVIDER_PRIVKEY` or `LUMEN_PROVIDER_PRIVKEY` continue to
> work — the resolution chain is `AGORA_*` → `ANDROMEDA_*` → `LUMEN_*`.
> New auto-generated keys are written under `AGORA_*` names.

### Step 3 · Flip the flags (10 sec)

In **both** `provider/.env.local` and `buyer/.env`:

```diff
- MOCK_MODE=true
+ MOCK_MODE=false
```

(And in `mcp/.env` if you want real-mode through PayMyAgent.)

### Step 4 · Run

The provider issues a real bolt-11 invoice. The buyer's NWC client
pays it. Lightning settles in 200–800 ms. The provider verifies the
preimage against the on-chain `payment_hash` and serves the result.

Watch the Alby Hub UI in another tab to see the sats move.

---

## Test gates

Each phase ships a script that boots its own services and asserts
behaviour, not just `200 OK`.

```bash
npm run test:phase0       # 12/12 — workspace structure, @agora/core, ADR 0013 assertions
npm run test:phase1b      # 16/16 — multi-seller paid round-trip, all 3 header families recognised
npm run test:phase2       # 12/12 — subscriptions on market-monitor (canonical + alias)
npm run test:phase3       # 12/12 — control plane, kill-switch, ~/.agora migration
npm run test:phase3-ui    # 16/16 — dashboard build + 5 control-plane proxies + CORS
npm run test:phase4       # 11/11 — orchestrator weights, score breakdown
npm run test:phase5       # 16/16 — escrow split 95/5, slashing, 90-day decay
npm run test:phase6       # 10/10 — dataset purchase + 2% platform fee math
npm run test:phase7       # 14/14 — web index 7 pages + sitemap + robots (registry must be running on 3030)
npm run test:mcp          # 12/12 — legacy regression on lumen_* aliases
```

---

## Known limitations (honest)

The repo ships three independent audits: behaviour
([`docs/audit-behavior.md`](docs/audit-behavior.md)), security
([`docs/audit-security.md`](docs/audit-security.md)), and design
([`docs/audit-design.md`](docs/audit-design.md)). They are independent
paper reviews, not action items. Highlights:

- **Tauri GUI is a stub.** Vite SPA is the canonical dashboard. ADR 0006 / 0011.
- **Embeddings are deterministic-hash pseudo-embeddings**, not learned
  vectors. ADR 0007 captures the upgrade path.
- **Phase-2 subscribe trust-deposits.** Real-mode subscription opens are
  not gated by L402; cancel-refund in real mode is not wired. ADR 0005.
- **Phase-5 buyer-side fraud slashing isn't implemented**, and silent
  re-review sampling isn't running. ADR 0010 admits both.
- **Two-step Lightning settlement to a platform NWC is mock-only**;
  `platform_fee_sats` is a counter, not a payout. ADR 0008.
- **`agora_purchase_dataset` returns "not implemented" in real mode.**
  Mock-mode purchase works fully.
- **Three provider subscription sub-routes** (`/topup`, `/cancel`,
  `/alerts`) currently return Next.js HTML 404 — see
  `docs/audit-behavior.md` §3 for repro. The market-monitor's
  equivalent endpoints work; phase-2 tests run against those.
- **Audit findings remain open.** The behaviour audit found 3 broken
  provider routes; the security audit reports 4 P0 issues (most notably
  Sybil rating via forged tx and unauthenticated subscription writes);
  the design audit confirms 0 of the previous 5 top concerns have been
  addressed and 1 (header-family widening) shifted worse with ADR 0013.

The legacy `npm run test:phase1` script is intact but fails 1/16 on a
clean clone because `LUMEN_ADMIN_USER` / `LUMEN_ADMIN_PASS` aren't set
— this is the M1 single-provider gate, kept for historical regression
only.

---

## Architecture / ADRs

All non-trivial decisions are captured in
[`docs/decisions/`](docs/decisions/):

- [ADR 0001](docs/decisions/0001-architecture-overview.md) — overview, working principles
- [ADR 0002](docs/decisions/0002-rebrand-lumen-to-andromeda.md) — first rebrand (superseded by 0013)
- [ADR 0003](docs/decisions/0003-workspace-tool.md) — npm workspaces
- [ADR 0004](docs/decisions/0004-registry-design.md) — Next.js + SQLite + FTS5 + signed writes
- [ADR 0005](docs/decisions/0005-subscriptions.md) — prepaid balance + polled alerts
- [ADR 0006](docs/decisions/0006-dashboard-shell.md) — control plane in MCP, Tauri deferred
- [ADR 0007](docs/decisions/0007-embeddings.md) — deterministic-hash pseudo-embedder for v0
- [ADR 0008](docs/decisions/0008-dataset-seller.md) — dataset distribution + platform fee
- [ADR 0010](docs/decisions/0010-peer-review.md) — honor + peer review
- [ADR 0011](docs/decisions/0011-dashboard-implementation.md) — Vite SPA over Tauri-only
- [ADR 0012](docs/decisions/0012-public-web-index.md) — public web index (Next.js + RSC, 7 pages)
- [ADR 0013](docs/decisions/0013-rebrand-andromeda-to-agora.md) — second & final rebrand to Agora

For the day-to-day inventory of every endpoint / tool / test, read
[`docs/BUILD-SUMMARY.md`](docs/BUILD-SUMMARY.md). For phase-by-phase
deltas, [`CHANGELOG.md`](CHANGELOG.md).

---

## Want Claude to drive it?

[`PAYMYAGENT.md`](PAYMYAGENT.md) walks through wiring the Agora MCP
server into Claude Desktop in five minutes. You give Claude a budget,
a goal, and a wallet; it pays per task on the open Lightning Network.
End-to-end verifiable via `npm run test:mcp` (12 checks, no Claude
install required).

---

Powered by ⚡ Lightning. Built for [SPIRAL × Hack-Nation Challenge 02](https://spiral.xyz).
