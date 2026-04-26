# PayMyAgent — give Claude a sat budget and a job

PayMyAgent is the human-facing half of Agora. It's an **MCP server** that
lets your AI assistant — Claude Desktop, Cursor, Claude Code, anything
that speaks the [Model Context Protocol](https://modelcontextprotocol.io)
— hire Agora providers per task and pay them with Lightning sats *out of
a wallet you control*, up to *a budget you set*.

> Tools are registered under the canonical `agora_*` prefix. The
> deprecated `andromeda_*` and `lumen_*` prefixes still resolve (ADRs
> 0002 + 0013) so existing Claude Desktop configs keep working
> unchanged.

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
                    │  Agora MCP server│   ← this folder (mcp/)
                    │  • budget cap    │
                    │  • per-call cap  │
                    └────────┬─────────┘
                             │ HTTP + Lightning (NWC)
                             ▼
                    ┌──────────────────┐
                    │  Agora provider  │   ← provider/, /api/v1/*
                    └──────────────────┘
```

The seven canonical tools are exposed to the agent (ADR 0013 — the
`andromeda_*` and `lumen_*` rows show the deprecated aliases that
continue to resolve to the same handlers):

| Canonical tool          | Deprecated aliases                          | Cost              | What it does                                                  |
|-------------------------|---------------------------------------------|-------------------|---------------------------------------------------------------|
| `agora_status`          | `andromeda_status`, `lumen_status`          | free              | Wallet mode, budget, remaining, provider URL                  |
| `agora_discover`        | `andromeda_discover`, `lumen_discover`      | free              | What the connected provider sells                             |
| `agora_balance`         | `andromeda_balance`, `lumen_balance`        | free              | Lightning wallet balance via NWC                              |
| `agora_set_budget`      | `andromeda_set_budget`, `lumen_set_budget`  | free              | Reset the per-session sat cap                                 |
| `agora_verify_listing`  | `andromeda_verify_listing`, `lumen_verify_listing` | ~240 sat (~$0.16) | OSM-geocoded listing verification                          |
| `agora_file_receipt`    | `andromeda_file_receipt`, `lumen_file_receipt`     | ~120 sat (~$0.08) | Signed delivery receipt for an order                       |
| `agora_fetch_receipt`   | `andromeda_fetch_receipt`, `lumen_fetch_receipt`   | free              | Replay a receipt the agent already paid for               |

(Phase 1+ tools — `agora_search_services`, `agora_subscribe`,
`agora_recommend`, `agora_purchase_dataset`, etc. — additionally
register their `andromeda_*` rebrand-1 alias only, because they post-date
the LUMEN era.)

---

## 5-minute install (Claude Desktop)

### 1 · Install the dependencies

```bash
cd C:\Users\<you>\…\HacknationV5
npm run install:all
cd mcp && npm install && cd ..
```

### 2 · Start the Agora provider locally

```bash
npm run provider           # http://localhost:3000
```

Leave that terminal running. Visit <http://localhost:3000> to confirm the
dashboard says **MAINNET · LIVE** (or **MOCK · NO SATS** if you're starting
in mock mode).

### 3 · Configure Claude Desktop

Open Claude Desktop's config file:

- **Windows** — `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the Agora server. The whole config looks like this — adjust the path
to where you cloned the repo:

```json
{
  "mcpServers": {
    "agora": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\…\\HacknationV5\\mcp\\server.js"],
      "env": {
        "AGORA_PROVIDER_URL": "http://localhost:3000",
        "MOCK_MODE":          "true",
        "MAX_PRICE_SATS":     "4000",
        "MAX_BUDGET_SATS":    "5000"
      }
    }
  }
}
```

> **Start in `MOCK_MODE=true`.** No sats move. You can confirm Claude can
> see the tools without putting your wallet at risk. Flip to real
> Lightning in step 5.
>
> Existing configs that use the `lumen` MCP key + `LUMEN_PROVIDER_URL`
> env var (or `andromeda` / `ANDROMEDA_PROVIDER_URL`) continue to work —
> the env-var resolution chain is `AGORA_*` → `ANDROMEDA_*` →
> `LUMEN_*`.

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

In **MOCK** mode this all happens without spending real money. In **REAL**
mode (next step), 720 sats will leave your `lumen-buyer` Alby wallet and
arrive in your `lumen-provider` wallet, visible in the Hub log.

### 5 · Flip to real Lightning

When you're ready:

1. Open `mcp/.env` and set `NWC_URL=` to a real `nostr+walletconnect://…`
   string from Alby Hub. Reuse the `lumen-buyer` app or create a third
   `lumen-mcp` app.
2. Set `MOCK_MODE=false` in `mcp/.env`.
3. Set `MOCK_MODE=false` in `provider/.env.local`.
4. Top the buyer wallet up with at least 1,000 sats.
5. Restart Claude Desktop (or just reload the MCP server).

Run the demo prompt again. This time real sats move.

---

## How the guardrails work

The MCP server enforces three layers of spending discipline so you can
hand the budget to an autonomous agent without anxiety:

1. **Per-call cap** — `MAX_PRICE_SATS` (default 4,000). Any single
   invoice priced above this is refused before the wallet is touched.
2. **Per-session budget** — `MAX_BUDGET_SATS` (default 5,000). Reset by
   the `agora_set_budget` tool (or its deprecated `andromeda_*` /
   `lumen_*` aliases). Once the cap is reached, every paid tool refuses
   with `budget exceeded`.
3. **Per-call confirmation** — every tool response includes the
   `budget` block:

   ```json
   "budget": { "budget_sats": 1500, "spent_sats": 720, "remaining_sats": 780, "started_at": "…" }
   ```

   so the model can read its own remaining headroom and stop in time
   without you having to remind it.

The session state persists in `<repo>/.mcp-session.json` so a Claude
Desktop reload doesn't reset the budget mid-task.

---

## End-to-end test (no Claude Desktop required)

You don't have to install Claude Desktop to verify the MCP server is
sound. The repo ships an automated probe:

```bash
npm run test:mcp
```

It spawns the provider, spawns the MCP server over stdio, lists tools,
calls `lumen_set_budget(1000)` then `lumen_verify_listing` (using the
deprecated lumen_* aliases on purpose, to prove they still work), then
fires five more verifies until the budget refuses, then files + fetches
a receipt. Twelve checks; should print `PASS · 12/12`.

---

## Why this matters (the pitch in one paragraph)

> *402index.io and agentic.market are phone books. unhuman.coffee is a
> single shop. **Agora is the bid layer in between.** PayMyAgent is the
> bridge that puts the bid layer behind a chat box: a human gives Claude
> a budget, a goal, and a wallet; Claude pays per task on the open
> Lightning Network; the human gets the result. No accounts. No API
> keys. No checkout. No human in the loop except at the start (the
> goal) and the end (the answer).*

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
