# PayMyAgent — give Claude a sat budget and a job

PayMyAgent is the buyer-side half of **Agora**. It's an **MCP server**
that lets your AI assistant — Claude Desktop, Cursor, Claude Code,
anything that speaks the [Model Context Protocol](https://modelcontextprotocol.io)
— hire Agora providers per task and pay them with Lightning sats *out
of a wallet you control*, up to *a budget you set*.

> Tools register under the canonical `agora_*` prefix. The deprecated
> `andromeda_*` and `lumen_*` prefixes still resolve (ADRs 0002 + 0013)
> so existing Claude Desktop configs keep working unchanged.
>
> Env vars resolve `AGORA_*` → `ANDROMEDA_*` → `LUMEN_*`. First defined
> wins.

```
                    ┌──────────────────┐
                    │  YOU (a human)   │
                    └────────┬─────────┘
                             │ "verify these 5 hotels for me, $1 budget"
                             ▼
                    ┌──────────────────┐
                    │  Claude Desktop  │
                    └────────┬─────────┘
                             │ MCP / stdio
                             ▼
                    ┌──────────────────┐
                    │  PayMyAgent MCP  │   ← this folder (mcp/)
                    │  • per-call cap  │
                    │  • per-session   │
                    │    budget        │
                    │  • kill-switch   │
                    │  • localhost     │
                    │    control plane │
                    └────────┬─────────┘
                             │ HTTP + Lightning (NWC)
                             ▼
              ┌──────────────────────────────┐
              │  Agora providers             │
              │  • vision-oracle-3 (3000)    │
              │  • market-monitor   (3100)   │
              │  • dataset-seller   (3200)   │
              │  • registry         (3030)   │
              └──────────────────────────────┘
```

## The 23 canonical `agora_*` tools

Every `agora_*` tool has an `andromeda_*` deprecated alias. The
**original 7** (the ones that pre-dated Phase 1) additionally keep
their `lumen_*` alias from the LUMEN era. Old aliases carry a
`[deprecated alias of agora_<name> — will be removed in a future release]`
prefix in their description so MCP hosts can surface the warning.

> **Sidebar — old names still work.** Existing Claude Desktop configs
> referencing `lumen_verify_listing`, `andromeda_subscribe`, etc.
> continue to resolve to the same handler. New code should use
> `agora_*`.

| Canonical                              | Cost              | What it does                                              |
|----------------------------------------|-------------------|-----------------------------------------------------------|
| `agora_status`                         | free              | Wallet mode, budget, registry health, identity            |
| `agora_discover`                       | free              | What the connected provider sells                         |
| `agora_discover_all`                   | free              | Multi-seller catalogue across the registry                |
| `agora_balance`                        | free              | NWC wallet balance                                        |
| `agora_set_budget`                    | free              | Reset the per-session sat cap                             |
| `agora_verify_listing`                 | ~240 sat (~$0.16) | OSM-geocoded listing verification                         |
| `agora_file_receipt`                   | ~120 sat (~$0.08) | Signed delivery receipt for an order                      |
| `agora_fetch_receipt`                  | free              | Replay a previously-paid receipt                          |
| `agora_search_services`                | free              | Registry FTS5 search                                      |
| `agora_list_sellers`                   | free              | Paginated seller list                                     |
| `agora_recommend`                      | free              | Orchestrator with explainable score breakdown             |
| `agora_subscribe`                      | mock-deposit      | Open a subscription with a seller                         |
| `agora_list_subscriptions`             | free              | Local subscription cache                                  |
| `agora_check_alerts`                   | free              | New alerts for a sub since the last check                 |
| `agora_topup_subscription`             | mock-deposit      | Add balance to an open sub                                |
| `agora_cancel_subscription`            | refund (mock)     | Cancel + return remaining balance                         |
| `agora_rate_seller`                    | free (signed)     | Buyer rating, 30-day tx gate enforced server-side         |
| `agora_request_review`                 | escrow            | Seller requests peer review                               |
| `agora_set_reviewer_availability`      | free (signed)     | Make this identity reviewer-eligible                      |
| `agora_check_review_assignments`       | free              | Reviewer's open assignments                               |
| `agora_submit_review`                  | free (signed)     | Reviewer submits the rubric                               |
| `agora_browse_datasets`                | free              | Dataset-seller catalogue                                  |
| `agora_purchase_dataset`               | 5000 sat (mock)   | NOAA PNW 2015–25 (real-mode is **not implemented** in MCP) |
| `agora_list_datasets`                  | free              | Locally-purchased datasets                                |

The **original 7** (`status`, `discover`, `balance`, `set_budget`,
`verify_listing`, `file_receipt`, `fetch_receipt`) additionally
register under their `lumen_*` names. The other 16 register under
`agora_*` plus their rebrand-1 `andromeda_*` alias only — the LUMEN
era was over before they existed.

**37 registered names → 23 unique handlers.**

---

## Wire format note (ADR 0014)

The seller side mints **MoneyDevKit (MDK)** L402 macaroons. The buyer
side — this MCP server — treats macaroons as opaque blobs that ride in
the `Authorization: L402 <macaroon>:<preimage>` header on replay, so
the migration is **invisible from the buyer's perspective**. No code
changes here. NWC via `@getalby/sdk` `LNClient.pay(invoice)` continues
to be the buyer's only Lightning primitive. Already-paid credentials
issued before ADR 0014 still verify for one deprecation cycle.

---

## 5-minute install (Claude Desktop)

### 1 · Install the dependencies

```bash
cd /path/to/lumen
npm install
cd packages/agora-core && npx tsc -p tsconfig.json && cd ../..
```

### 2 · Start an Agora provider locally

The simplest target is the original provider (port 3000). Start it in
its own terminal:

```bash
npm run provider           # http://localhost:3000
```

Leave it running. Visit <http://localhost:3000> to confirm the
dashboard says **MAINNET · LIVE** (or **MOCK · NO SATS** if you're
starting in mock mode).

For multi-seller flows you'll also want the registry running:

```bash
npm run registry           # http://localhost:3030
```

### 3 · Configure Claude Desktop

Open Claude Desktop's config file:

- **Windows** — `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the Agora server. Adjust the path to where you cloned the repo:

```json
{
  "mcpServers": {
    "agora": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\…\\lumen\\mcp\\server.js"],
      "env": {
        "AGORA_PROVIDER_URL": "http://localhost:3000",
        "AGORA_REGISTRY_URL": "http://localhost:3030",
        "MOCK_MODE":          "true",
        "MAX_PRICE_SATS":     "4000",
        "MAX_BUDGET_SATS":    "5000"
      }
    }
  }
}
```

> **Start in `MOCK_MODE=true`.** No sats move. You can confirm Claude
> can see the tools without putting your wallet at risk. Flip to real
> Lightning in step 5.

> **Old configs still work.** If your existing config uses the `lumen`
> or `andromeda` MCP key with `LUMEN_PROVIDER_URL` /
> `ANDROMEDA_PROVIDER_URL`, leave it alone — the resolution chain is
> `AGORA_*` → `ANDROMEDA_*` → `LUMEN_*` and tool aliases still
> resolve.[^aliases]

[^aliases]: `andromeda_*` and `lumen_*` aliases will be removed in a
future major-version bump. ADR 0013 §"Migration timeline".

Restart Claude Desktop. In a new chat, the Agora tools should now show
up in the tool list.

### 4 · Try the demo prompt

Paste this into Claude Desktop:

> *I have a budget of 1,500 sats. Use the Agora MCP tools to verify
> these three places, then give me back a clean markdown table:*
> - *Eiffel Tower Paris*
> - *Brandenburger Tor Berlin*
> - *Hotel Adlon Berlin*
>
> *Use 2026-03-14 as the date. Include the resolved name, the OSM
> coordinates, and the confidence for each.*

Claude will:

1. Call `agora_set_budget(1500)` to enforce the cap.
2. Call `agora_verify_listing` three times, paying 240 sat each.
3. Read the proofs.
4. Render a markdown table.
5. Stop, because the budget is exhausted and any 4th call would refuse.

In **MOCK** mode this all happens without spending real money. In
**REAL** mode (next step), 720 sats will leave your `agora-buyer` Alby
wallet and arrive in your `agora-provider` wallet, visible in the Hub
log.

### 5 · Flip to real Lightning

When you're ready:

1. Open `mcp/.env` and set `NWC_URL=` to a real
   `nostr+walletconnect://…` string from Alby Hub. Reuse `agora-buyer`
   or create a third `agora-mcp` app.
2. Set `MOCK_MODE=false` in `mcp/.env`.
3. Set `MOCK_MODE=false` in `provider/.env.local`.
4. Top the buyer wallet up with at least 1,000 sats.
5. Restart Claude Desktop (or reload the MCP server).

Run the demo prompt again. This time real sats move.

> Note: `agora_purchase_dataset` currently returns `"real-mode dataset
> payment not implemented in MCP yet (NWC route)"` in real mode. The
> mock-mode purchase works end-to-end. Tracked in
> `docs/audit-behavior.md` §8 (P1).

---

## How the guardrails work

The MCP server enforces three layers of spending discipline so you
can hand the budget to an autonomous agent without anxiety:

1. **Per-call cap** — `MAX_PRICE_SATS` (default 4,000). Any single
   invoice priced above this is refused before the wallet is touched.
2. **Per-session budget** — `MAX_BUDGET_SATS` (default 5,000). Reset
   by the `agora_set_budget` tool (or its deprecated `andromeda_*` /
   `lumen_*` aliases). Once the cap is reached, every paid tool
   refuses with `budget exceeded`.
3. **Per-call confirmation** — every tool response includes the
   `budget` block:

   ```json
   "budget": { "budget_sats": 1500, "spent_sats": 720, "remaining_sats": 780, "started_at": "…" }
   ```

   so the model can read its own remaining headroom and stop in time
   without you having to remind it.

The session state persists in `<repo>/.mcp-session.json` so a Claude
Desktop reload doesn't reset the budget mid-task. The local control
plane (next section) adds a fourth layer: a human-flippable
**kill-switch** that refuses every paid tool with `kill_switch_active`.

---

## Local control plane + Dashboard SPA

The MCP server also exposes a **localhost-only HTTP control plane**
(random port, bound to `127.0.0.1`, bearer-token auth). On startup it
writes:

- the port to `~/.agora/control-port`
- the bearer token to `~/.agora/control-token` (mode `0600` on POSIX,
  best-effort on Windows)

If a legacy `~/.andromeda/` exists from the previous rebrand, the MCP
copies it forward on first start, drops a `MIGRATED-FROM-ANDROMEDA`
marker, and leaves the old directory in place. ADR 0013.

The **dashboard SPA** (`dashboard/`, Vite + React + TS + Tailwind +
Zustand) is the human-friendly UI on top of the control plane:

```bash
npm run mcp           # writes the port + token files
npm run dashboard     # http://localhost:5173
```

On first load the SPA asks for the port + bearer token (paste both —
they're cached in `localStorage`). Sections: **Wallet** ·
**Allowance** (kill-switch lives here) · **Active subscriptions** ·
**Transactions** · **Sellers I've used**.

CORS is allow-listed to `http://localhost:5173` only; the SPA never
talks to the registry directly — the control plane proxies the
relevant reads. ADR 0011.

---

## End-to-end test (no Claude Desktop required)

You don't have to install Claude Desktop to verify the MCP server is
sound. The repo ships an automated probe:

```bash
npm run test:mcp
```

It spawns the provider, spawns the MCP server over stdio, lists tools,
calls `lumen_set_budget(1000)` then `lumen_verify_listing` (using the
deprecated `lumen_*` aliases on purpose, to prove they still work),
then fires five more verifies until the budget refuses, then files +
fetches a receipt. Twelve checks; should print `PASS · 12/12`.

Phase-1b adds canonical-and-alias regression coverage:

```bash
npm run test:phase1b      # PASS · 16/16
```

asserts all 10 `agora_*` canonical tools register, all 10
`andromeda_*` deprecated aliases register, all 7 `lumen_*` aliases
register, both `X-Agora-*` and `X-Andromeda-*` tamper paths return
401, and a paid `agora_verify_listing` round-trip lands a real tx in
the registry's seller stats.

---

## Why this matters (the pitch in one paragraph)

> *402index.io and agentic.market are phone books.
> unhuman.coffee is a single shop. **Agora is the bid layer in
> between.** PayMyAgent is the bridge that puts the bid layer behind a
> chat box: a human gives Claude a budget, a goal, and a wallet;
> Claude pays per task on the open Lightning Network; the human gets
> the result. No accounts. No API keys. No checkout. No human in the
> loop except at the start (the goal) and the end (the answer).*

---

## Troubleshooting

- **Claude doesn't see the Agora tools.** Confirm the path in
  `claude_desktop_config.json` is absolute and uses double-backslashes
  on Windows. Restart Claude Desktop fully (right-click tray icon →
  Quit, not just close the window).
- **`NWC_URL not set`** — you flipped `MOCK_MODE=false` without pasting
  a NWC string into `mcp/.env`.
- **`budget exceeded` on the first call** — `MAX_BUDGET_SATS` is too
  low; bump it in `mcp/.env` or call `agora_set_budget` from the chat.
- **Provider unreachable** — the Agora provider must be running locally
  at `AGORA_PROVIDER_URL` (or the legacy `ANDROMEDA_PROVIDER_URL` /
  `LUMEN_PROVIDER_URL`). Run `npm run provider` from the repo root.
- **Dashboard SPA stuck on the setup screen.** Make sure
  `npm run mcp` is running first — without it the port + token files
  in `~/.agora/` don't exist.
- **`agora_purchase_dataset` returns "not implemented" in real mode.**
  Known limitation; the mock-mode path works. See
  `docs/audit-behavior.md` §8 (P1).
