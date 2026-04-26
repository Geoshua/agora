# Agora — 60-second tech demo script

Read this off-camera or on a confidence monitor. Each beat names the slide to show. Total ≈ 145 words at conversational pace (~2.4 words/sec). Practice once and you'll land within ±3 seconds.

---

## Beat 1 — the hook (10 s)

> [SLIDE: `01-architecture.svg`]
>
> **Agora is a marketplace where AI agents pay each other over the Lightning Network — no accounts, no API keys, no checkout.** Five services: a registry, three sellers, a Claude bridge.

## Beat 2 — the atom (15 s)

> [SLIDE: `02-l402-flow.svg`]
>
> **One paid call takes 200 milliseconds.** The agent posts a request — gets back HTTP 402 and a Lightning invoice. Pays it. Replays the request with the preimage as proof. Server verifies, returns the result. That's the whole protocol — it's called L402.

## Beat 3 — why it works without accounts (10 s)

> [SLIDE: `03-identity-signing.svg`]
>
> **Identity is an Ed25519 keypair.** Every agent generates one on first run. The public key IS the agent's global ID. Every cross-service call is signed. There is no users table.

## Beat 4 — the agent UX (10 s)

> [SLIDE: `06-mcp-bridge.svg`]
>
> **You give Claude a goal and a sat budget.** A per-call cap, a per-session budget, and a kill switch sit between Claude and your wallet. You stay in custody.

## Beat 5 — close (15 s)

> [SLIDE: `04-phases.svg`]
>
> **Eight build phases, 144 of 144 tests green, three independent security audits.** L402 wire format is byte-aligned with MoneyDevKit. Mock mode runs offline; flip two flags and you're on Lightning mainnet. **The repo is live. The marketplace works today.**

---

## Variants if you have less time

### 30-second elevator (use slides 1 + 2 only)

> Agora is a Lightning-paid agent marketplace. AI agents discover, pay, and use each other's services autonomously over HTTP 402 — 200 milliseconds per call, no accounts, no API keys. Five services. Eight build phases shipped. Mock mode runs offline; flip two flags for mainnet. Identity is an Ed25519 keypair — the public key IS the agent.

### 90-second extended (add `05-money-flow.svg` between beats 3 and 4)

After beat 3, insert:

> [SLIDE: `05-money-flow.svg`]
>
> **Money moves on real Lightning.** Buyer pays 240 sats — about 16 cents. Provider gets 239 net of routing. Settlement in under a second, on a public network. The registry's transaction ledger updates within 2 seconds — visible at `/activity` on the public web index. Mock and real share one wire format.

## Cues for the speaker

- **Pause on slide 2** for one breath after "200 milliseconds" — it's the headline number.
- **Keep slide 3 short.** "No users table" is the takeaway. Don't read the canonical-string syntax.
- **Slide 4 is the human-trust pitch.** If the audience is buyers / brand-side, dwell here.
- **End on the test count.** "144 of 144" is the credibility close.
- If you're cut off, stop on the closing line: *"The repo is live. The marketplace works today."*

## Numbers worth quoting

| | |
|---|---|
| Per-call latency | ~200 ms (mainnet) |
| Cheapest paid call | 120 sat (~$0.08) — order receipt |
| Most expensive paid call | 5000 sat (~$3.30) — NOAA dataset |
| Smallest unit cards can price | ~30¢ — too coarse for 240-sat verifies |
| Build phases shipped | 8 |
| Test gates green | 144 / 144 |
| MCP tools registered | 30 (23 canonical + 7 deprecated aliases) |
| Lightning fee on a typical 240-sat call | ~1 sat |

## Commands the audience can run after

```bash
git clone git@github.com:Geoshua/agora.git
npm run install:all && npm run demo:multi   # mock mode, no wallet needed, ~200ms × 2 calls
```
