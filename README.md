# LUMEN — Earn in the Agent Economy

A working demo for **SPIRAL × Hack-Nation Challenge 02**.

LUMEN is a Lightning-paywalled marketplace that AI agents can buy from
autonomously. A buyer agent (`tripplanner-7`) needs a hotel listing
verified, and then needs an audit receipt for the order it just placed.
The provider (`vision-oracle-3`) sells **two services on one wallet**:

- **`listing-verify`** — OSM-geocoded ground truth, **240 sat** (~$0.16), ~1.1 s
- **`order-receipt`** — HMAC-signed delivery receipt, **120 sat** (~$0.08), ~350 ms

Plus a free **`/api/v1/discovery`** endpoint that publishes the catalogue
in a format crawlable by directories like
[402index.io](https://402index.io). The whole round-trip — `402 → invoice
→ pay → replay → 200` — happens in ~200 ms per call, end-to-end, with no
accounts, no API keys, no checkout.

```
buyer  ──POST /v1/listing-verify──►  provider
       ◄─ 402 + bolt-11 invoice ───
       ──pay (NWC) → preimage ────►  Lightning Network
       ──Authorization: L402 …────►  provider
       ◄─ 200 + verification proof ─
```

Two endpoints, ~250 lines of code, the L402 protocol from the brief.

---

## What's in here

| path                | what it is                                                    |
|---------------------|---------------------------------------------------------------|
| `concept.html`      | Editorial concept page (open in any browser).                 |
| `provider/`         | Next.js 16 service that sells `listing-verify` over L402.     |
| `buyer/`            | Node script — the AI agent that auto-pays the paywall.        |
| `mcp/`              | **PayMyAgent** — MCP server so Claude Desktop / Cursor can hire LUMEN providers per task. See [`PAYMYAGENT.md`](PAYMYAGENT.md). |
| `dashboard/`        | Vite + React + TS + Tailwind SPA. One-screen view of wallet, allowance, subs, txs, sellers. Talks to the MCP control plane on `127.0.0.1`. ADR 0011. |
| `web/`              | **Public web index** (Phase 7) — read-only Next.js site over the registry. Port 3300. See [Public web index](#public-web-index) below. |
| `scripts/`          | `preflight.js`, `test-phase1.js`, `test-mcp.js`, `test-phase3-ui.js`, `test-phase7.js`, … |
| `demo.js`           | One-command launcher for provider + buyer.                    |

### Public web index

A read-only browser-facing site at <http://localhost:3300> that surfaces
the registry's public REST endpoints. No accounts, no forms, no writes.

```bash
npm run registry       # in one shell — boots the registry on :3030
npm run web            # in another — boots the web index on :3300
# then open http://localhost:3300
```

Pages: `/` (hero + headline stats + featured services), `/sellers` (list
+ search + sort), `/sellers/:pubkey` (seller detail), `/services`
(catalog + filters), `/services/:id` (service detail + similar),
`/search?q=` (FTS5), `/recommend?intent=` (orchestrator score
breakdown). Server-rendered with Next.js 16 RSC. See
[ADR 0012](docs/decisions/0012-public-web-index.md) for design.

---

## Quick start (no wallet, no setup)

Both apps default to **MOCK_MODE=true** — fake invoices, deterministic preimages,
zero sats moved. Use this to verify everything works before touching a wallet.

```bash
# from the repo root
npm run install:all

# single-service flow:
npm run demo

# multi-service flow (verify → receipt, two services on one wallet):
npm run demo:multi
```

You should see the provider start, the buyer run once, the steps print out, and
the verification proof + signed receipt come back. The provider stays up at
<http://localhost:3000> afterwards — visit it in a browser to see the dashboard.

---

## Dashboard UI

A single-screen local dashboard lives in `dashboard/` (Vite + React + TS + Tailwind + Zustand).
It talks only to the **MCP control plane** — never to the registry directly — so
the bearer token, kill switch, and CORS scope cover every section.

```bash
# 1. Make sure the MCP is running (writes the port + token to ~/.andromeda/):
npm run mcp

# 2. In another terminal, start the dashboard SPA on http://localhost:5173:
npm run dashboard
```

On first load the SPA asks for the **port** (`~/.andromeda/control-port`) and
**bearer token** (`~/.andromeda/control-token`). Paste both — they're cached
in `localStorage`, so subsequent visits go straight to the dashboard.

Sections:

- **Wallet** — NWC balance, top-up button (opens Alby Hub), last 10 local txs.
- **Allowance** — daily-cap slider, per-call slider, big red kill-switch toggle.
- **Active subscriptions** — sat-per-event subs with runway estimate + cancel.
- **Transactions** — `~/.andromeda/transactions.log` (full history, JSONL).
- **Sellers I've used** — txs grouped by seller with totals + last interaction.

### Tauri shell (optional)

`npm run dashboard:tauri:build` will use the real Tauri CLI when `cargo` is on
PATH. Without Rust installed, it prints actionable instructions and exits 0 —
the SPA is always usable in a browser regardless. ADR 0011 captures the
SPA-first-Tauri-optional decision.

```bash
# enable Tauri (one-time)
cargo install tauri-cli
cd dashboard && npx tauri init
```

### Dashboard test gate

```bash
npm run test:phase3-ui          # PASS · 16/16
```

Spawns a fresh MCP control plane, hits all 5 new HTTP proxies, verifies CORS
preflight from `http://localhost:5173` works and from `http://evil.com` is
rejected, builds the SPA, and string-matches the endpoint paths in the bundle.

---

## Going live on Lightning (real sats, mainnet)

Three things you do, two flags I flip.

### Step 1 · Get an Alby Hub account (you, ~3 min)

1. Go to <https://albyhub.com/> → **Sign up** (Alby Cloud is the cheapest path; ~30 sec).
2. Once signed in: top up with **5,000 sats** (≈ $3.30) using the built-in
   "Buy Bitcoin" button. This covers ~20 demo runs.

### Step 2 · Create two NWC connection strings (you, ~2 min)

In Alby Hub: **Apps → Connect a new app**, twice.

| App name         | Permissions               | Paste into                  |
|------------------|---------------------------|-----------------------------|
| `lumen-provider` | `make_invoice, lookup_invoice` | `provider/.env.local`  → `NWC_URL=` |
| `lumen-buyer`    | `pay_invoice`             | `buyer/.env`     → `NWC_URL=` |

Each gives you a string starting with `nostr+walletconnect://…`. Paste it as the
`NWC_URL` value in the matching env file.

> ⚠️ The provider and buyer can technically share a single Alby wallet, but using
> two separate apps means you can see actual sats moving in the Hub's transaction
> log — way better demo.

### Step 3 · Flip the flags (you, 10 sec)

In **both** `provider/.env.local` and `buyer/.env`:

```diff
- MOCK_MODE=true
+ MOCK_MODE=false
```

### Step 4 · Run the demo (`npm run demo`)

The provider issues a real bolt-11 invoice. The buyer's NWC client pays it.
Lightning settles in 200–800 ms. The provider verifies the preimage against the
on-chain `payment_hash` and serves the result.

If you watch the Alby Hub UI in another tab, you'll see a 240-sat outgoing
payment from `lumen-buyer` and a 240-sat incoming payment to `lumen-provider`.

---

## How it's wired

### The L402 protocol (in 80 lines)

`provider/src/lib/l402.ts` is the whole paywall:

- **`require402(resource, sats, desc, ttl)`** — mints a macaroon (HMAC-signed
  capability token), creates a Lightning invoice via the wallet adapter,
  returns `HTTP 402` with `WWW-Authenticate: L402 macaroon="…", invoice="…"`.
- **`verifyAuth(authHeader, resource)`** — accepts the replay header
  `Authorization: L402 <macaroon>:<preimage>`, checks the HMAC, checks
  `SHA256(preimage) === payment_hash`, and (in real mode) confirms the invoice
  actually settled with the wallet.

That's it. Real L402 macaroons can carry richer caveats (scopes, expiry, rate
limits) — the spirit is identical here.

### The wallet adapter

`provider/src/lib/wallet.ts` exposes a 2-method interface (`makeInvoice`,
`lookupInvoice`) with two implementations:

- **mock** — generates deterministic preimage + hash pairs in-process.
- **real** — calls `@getalby/sdk` `NWCClient` over Nostr Wallet Connect.

Same interface either way, so the rest of the code never branches on mode.

### The buyer

`buyer/agent.js` is one self-contained Node script. It:

1. POSTs the task without auth → expects 402.
2. Parses the `WWW-Authenticate` header.
3. Runs a spending policy check (`MAX_PRICE_SATS`).
4. Pays — either via `LNClient.pay(invoice)` (real) or `/api/dev/pay` (mock).
5. Replays with the L402 auth header, receives the proof.
6. Prints a colored, time-stamped 6-step receipt.

---

## Endpoints

| method | path                       | purpose                                       | price    |
|--------|----------------------------|-----------------------------------------------|----------|
| GET    | `/api/health`              | Service info + current wallet mode.           | free     |
| GET    | `/api/v1/discovery`        | Catalogue of paid services (directory-ready). | free     |
| POST   | `/api/v1/listing-verify`   | OSM-geocoded listing verification.            | 240 sat  |
| POST   | `/api/v1/order-receipt`    | Signed delivery receipt for a paid order.     | 120 sat  |
| POST   | `/api/dev/pay`             | **MOCK ONLY** — hands back a preimage.        | n/a      |

All requests / responses are JSON.

---

## Mapping to the brief

| Brief tool        | What it does in LUMEN                                        |
|-------------------|--------------------------------------------------------------|
| **L402**          | The paywall handshake. Implemented in `provider/src/lib/l402.ts`. |
| **MoneyDevKit**   | See note below.                                              |
| **Alby**          | Both wallets. Single `@getalby/sdk` dependency on each side. |
| **Lexe**          | Drop-in replacement for the Alby provider wallet (set `NWC_URL` to a Lexe NWC string instead). |
| **Spark**         | Reserved for the v2 escrow layer — not in M1–M3 scope.       |

### Why the LUMEN provider doesn't import MDK

The brief markets MoneyDevKit as the canonical way to "add Lightning
payments to any API." In practice the runtime package
`@moneydevkit/nextjs` ships **checkout components** — React + Radix UI +
React Hook Form + QR codes — for selling things to humans through a UI,
not server-side L402 paywalls for selling to agents.

We needed an L402 *server*, so we wrote one — ~80 lines of HMAC-signed
macaroons + preimage verification (`provider/src/lib/l402.ts`). The
upside is a self-contained dependency-light demo with auditable surface
area; the only Lightning library on either end is `@getalby/sdk` (NWC).

If MDK ships an L402-server package later, this is a one-file swap.

## Mapping to the rubric

- **Novel & valuable** — agents can't buy listing-verify-with-photo-proof from any existing API. This sells it for $0.0016 a call.
- **Money moves** — verifiable on Alby Hub's transaction log; preimage included in the response header.
- **Trust & safety** — macaroons are HMAC-signed and resource-scoped; preimage proves payment cryptographically; buyer enforces a per-call cap.
- **Scale** — provider is stateless behind the Lightning rail; routes are async; Next.js handles concurrency.
- **Lightning-native** — couldn't work on cards (240 sat ≪ 30¢ minimum). Couldn't work on stablecoins (no preimage handshake; would need accounts).
- **End-to-end demo** — `npm run demo` shows the full flow in ~200 ms.

---

## Troubleshooting

- **`L402_SECRET must be set and ≥32 chars`** — open `provider/.env.local`, the dev value is already long enough.
- **`NWC_URL not set`** — you flipped `MOCK_MODE=false` without pasting NWC strings into both env files.
- **Real-mode payment hangs** — Alby Hub needs an inbound channel to receive. The first incoming payment auto-opens one, which can take ~10s on first run.
- **Port 3000 in use** — set `PORT=3001 npm run provider` and `PROVIDER_URL=http://localhost:3001` in `buyer/.env`.

---

## Want Claude to drive it?

[`PAYMYAGENT.md`](PAYMYAGENT.md) walks you through wiring the LUMEN MCP
server into Claude Desktop. Five minutes; gives Claude six tools, three
spending guardrails (per-call cap, per-session budget, persisted spend
counter), and the ability to hire LUMEN providers per task on real
Lightning. End-to-end verifiable via `npm run test:mcp` (12 checks, no
Claude install required).

---

Powered by ⚡ Lightning. Built for [SPIRAL × Hack-Nation Challenge 02](https://spiral.xyz).
