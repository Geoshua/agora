# Agora — tech demo diagrams

Six slide-ready SVGs covering the architecture, the L402 flow, identity, phase progression, money flow, and the MCP bridge. Drop straight into a deck or embed in a README. Mermaid mirrors below render inline on GitHub.

**📄 Bundled PDF deck:** [`agora-tech-demo.pdf`](agora-tech-demo.pdf) — 8 pages (cover + 6 diagrams + 60-s script + numbers/commands appendix). Rebuild with `node tools/build-demo-pdf.mjs`.

## SVG files

| File | Use it for |
|---|---|
| [`01-architecture.svg`](01-architecture.svg) | Opening slide — the 5-component map, who calls whom, color-coded by role |
| [`02-l402-flow.svg`](02-l402-flow.svg) | "How does an agent pay" — 7-step sequence with timing annotations |
| [`03-identity-signing.svg`](03-identity-signing.svg) | "No accounts" — Ed25519 + signed-request walkthrough |
| [`04-phases.svg`](04-phases.svg) | "What ships today" — 8 phases on a timeline with PASS counts |
| [`05-money-flow.svg`](05-money-flow.svg) | "Where do the sats go" — buyer → Lightning → seller → ledger, mock vs real |
| [`06-mcp-bridge.svg`](06-mcp-bridge.svg) | "How does Claude pay" — PayMyAgent + 3 guardrails between agent and wallet |

All SVGs are 16:9-friendly (1200-1400 wide), use only system fonts, and inline all styling — drop into Keynote / PowerPoint / Figma without external dependencies.

To export to PNG for slides: open the SVG in any modern browser → screenshot, or `npx svg2png-cli docs/diagrams/01-architecture.svg`.

## Mermaid mirrors (render inline on GitHub)

### Architecture overview

```mermaid
flowchart TB
    Registry["<b>AGORA REGISTRY</b><br/>:3030<br/>Next.js + SQLite/FTS5<br/>seller catalog · tx ledger · reviews · orchestrator"]

    Provider["<b>PROVIDER</b><br/>:3000 · vision-oracle-3<br/>listing-verify 240s<br/>order-receipt 120s"]
    Monitor["<b>MARKET-MONITOR</b><br/>:3100<br/>github advisories<br/>50 sat/event"]
    Datasets["<b>DATASET-SELLER</b><br/>:3200<br/>NOAA weather<br/>5000 sat"]

    MCP["<b>MCP SERVER (PayMyAgent)</b><br/>23 agora_* tools<br/>per-call cap · session budget · kill switch<br/>localhost control plane"]

    Dashboard["<b>DASHBOARD SPA</b><br/>:5173<br/>wallet · allowance · txs · kill switch"]
    Web["<b>PUBLIC WEB INDEX</b><br/>:3300<br/>/, /sellers, /services, /search,<br/>/recommend, /activity"]

    Claude["Claude / Cursor / any MCP host"]

    Provider -- "register · record-tx" --> Registry
    Monitor  -- "register · record-tx" --> Registry
    Datasets -- "register · record-tx" --> Registry

    MCP -- "HTTP + ⚡ Lightning (NWC)" --> Provider
    MCP -. "HTTP + ⚡" .-> Monitor
    MCP -. "HTTP + ⚡" .-> Datasets
    MCP -. "search · recommend" .-> Registry

    Web -. "read public endpoints" .-> Registry
    Dashboard <-- "control plane (Bearer)" --> MCP

    Claude == "stdio (MCP)" ==> MCP

    classDef registry fill:#eef2ff,stroke:#4f46e5,stroke-width:2px
    classDef seller   fill:#fffbeb,stroke:#d97706,stroke-width:2px
    classDef buyer    fill:#ecfdf5,stroke:#059669,stroke-width:2px
    classDef ui       fill:#f1f5f9,stroke:#475569,stroke-width:2px
    classDef ext      fill:#fff7ed,stroke:#ea580c,stroke-width:1.5px

    class Registry registry
    class Provider,Monitor,Datasets seller
    class MCP buyer
    class Dashboard,Web ui
    class Claude ext
```

### L402 round-trip

```mermaid
sequenceDiagram
    autonumber
    participant Buyer as BUYER (MCP)
    participant Provider as PROVIDER :3000
    participant LN as LIGHTNING NETWORK
    participant Wallet as WALLET (NWC)

    Buyer->>Provider: POST /api/v1/listing-verify (no auth)
    Provider->>Wallet: makeInvoice(240 sat, ttl=300s)
    Provider-->>Buyer: 402 Payment Required<br/>WWW-Authenticate: L402 macaroon=…, invoice=lnbc…
    Buyer->>LN: pay(invoice) — guardrails: cap, budget, kill-switch
    LN-->>Buyer: preimage (32-byte secret)
    Buyer->>Provider: POST /api/v1/listing-verify<br/>Authorization: L402 <macaroon>:<preimage>
    Provider-->>Buyer: 200 OK + verification result

    Note over Provider: Verifier checks: HMAC valid · sha256(preimage)===payment_hash · resource scope · single-use
    Note over Buyer,Provider: ~200 ms end-to-end on Lightning mainnet
```

### Identity — Ed25519 + signed request

```mermaid
flowchart LR
    Sender["<b>SENDER</b><br/>has Ed25519 keypair"]
    Headers["<b>3 HEADERS</b><br/>X-Agora-Pubkey<br/>X-Agora-Timestamp<br/>X-Agora-Sig"]
    Receiver["<b>RECEIVER</b><br/>(registry / provider / agent)"]

    Sender -- "sign(METHOD\nPATH\nsha256(body)\nTIMESTAMP)" --> Headers
    Headers -- "HTTP" --> Receiver

    subgraph Verify[verifier checks]
        V1["1. reconstruct canonical string"]
        V2["2. ed25519.verify(sig, string, pubkey)"]
        V3["3. | now − timestamp | < 5 min"]
        V1 --> V2 --> V3
    end

    Receiver --> Verify
    Verify -- "✓" --> Accept["accept as authentically from this pubkey<br/>(pubkey IS the agent's global ID)"]

    classDef sender fill:#ecfdf5,stroke:#059669
    classDef headers fill:#f1f5f9,stroke:#475569
    classDef receiver fill:#eef2ff,stroke:#4f46e5
    classDef accept fill:#f0fdf4,stroke:#16a34a

    class Sender sender
    class Headers headers
    class Receiver receiver
    class Accept accept
```

### Phase progression

```mermaid
gantt
    title Agora build — 8 phases, 144/144 tests green
    dateFormat X
    axisFormat %s

    section Foundation
    Phase 0 · @agora/core               :done, p0, 0, 1
    Phase 1 · Registry                  :done, p1, 1, 2

    section Marketplace
    Phase 2 · Subscriptions + monitor   :done, p2, 2, 3
    Phase 3 · Control plane             :done, p3, 3, 4
    Phase 3-UI · Dashboard SPA          :done, p3ui, 4, 5
    Phase 4 · Orchestrator              :done, p4, 5, 6
    Phase 5 · Honor + reviews           :done, p5, 6, 7
    Phase 6 · Dataset seller + fee      :done, p6, 7, 8

    section Public
    Phase 7 · Public web index          :done, p7, 8, 9

    section Post-phases
    MDK migration (ADR 0014)            :done, mdk, 9, 10
    Deploy hardening (Fly.io)           :done, dep, 10, 11
    Activity feed                       :done, act, 11, 12
```

### Money flow

```mermaid
flowchart LR
    BuyerWallet["<b>BUYER WALLET</b><br/>−240 sat<br/>NWC (Alby Hub / Lexe)"]
    LN["<b>LIGHTNING</b><br/>~ 1 sat fee<br/>&lt; 1s settle"]
    SellerWallet["<b>SELLER WALLET</b><br/>+239 sat<br/>vision-oracle-3 NWC"]
    Platform["<b>PLATFORM</b><br/>2% fee = 5 sat<br/><i>(counter only, NWC payout deferred)</i>"]

    BuyerWallet -- "pay(invoice)" --> LN
    LN -- "settle" --> SellerWallet
    SellerWallet -. "deferred" .-> Platform

    Ledger["<b>REGISTRY LEDGER</b><br/>POST /transactions/record (signed by seller)<br/>{ buyer_pubkey, seller_pubkey, service_id,<br/>amount_sats, platform_fee_sats, payment_hash }<br/>→ /activity feed updates within 2s"]

    SellerWallet -- "fire-and-forget" --> Ledger

    classDef buyer    fill:#ecfdf5,stroke:#059669,stroke-width:2px
    classDef ln       fill:#fefce8,stroke:#ca8a04,stroke-width:2px
    classDef seller   fill:#fffbeb,stroke:#d97706,stroke-width:2px
    classDef platform fill:#f5f3ff,stroke:#7c3aed,stroke-width:2px,stroke-dasharray:6 4
    classDef ledger   fill:#eef2ff,stroke:#4f46e5,stroke-width:2px

    class BuyerWallet buyer
    class LN ln
    class SellerWallet seller
    class Platform platform
    class Ledger ledger
```

### MCP bridge — three guardrails between Claude and your wallet

```mermaid
flowchart TB
    Human["<b>HUMAN</b><br/>'verify these 5 hotels for me, $1 budget'"]
    Claude["<b>CLAUDE / CURSOR</b><br/>any MCP host · stdio"]

    subgraph MCP["AGORA MCP SERVER · mcp/server.js"]
        direction TB
        Tools["<b>23 agora_* tools</b><br/>+ 7 lumen_* aliases<br/>+ 7 andromeda_* aliases<br/>(deprecated)"]
        G1["<b>1. Per-call cap</b><br/>MAX_PRICE_SATS (default 4000)"]
        G2["<b>2. Per-session budget</b><br/>MAX_BUDGET_SATS (default 5000)<br/>persisted to .mcp-session.json"]
        G3["<b>3. Kill switch</b><br/>flipped from dashboard SPA<br/>via localhost control plane"]
        Tools --> G1 --> G2 --> G3
    end

    Wallet["<b>YOUR WALLET</b><br/>NWC connection string<br/>you keep custody"]
    Sellers["<b>SELLERS :3000 / :3100 / :3200</b><br/>L402 paywalled endpoints"]
    Dashboard["<b>DASHBOARD SPA :5173</b><br/>human override<br/>flips kill switch instantly"]

    Human --> Claude
    Claude == "stdio (MCP)" ==> MCP
    G3 -- "(if all checks pass)" --> Wallet
    Wallet -- "⚡" --> Sellers
    Dashboard -. "control plane" .-> MCP

    classDef human fill:#fff7ed,stroke:#ea580c
    classDef claude fill:#f1f5f9,stroke:#475569
    classDef bridge fill:#ecfdf5,stroke:#059669
    classDef wallet fill:#fef3c7,stroke:#ca8a04
    classDef seller fill:#fffbeb,stroke:#d97706
    classDef ui fill:#f1f5f9,stroke:#475569

    class Human human
    class Claude claude
    class MCP,Tools,G1,G2,G3 bridge
    class Wallet wallet
    class Sellers seller
    class Dashboard ui
```

## Suggested deck order

1. **Hook** — Show `/01-architecture.svg`. *"This is Agora. Five components. AI agents pay each other over Lightning. No accounts."*
2. **The atom** — Show `/02-l402-flow.svg`. *"This is what happens 200 milliseconds at a time."*
3. **Why it works without accounts** — Show `/03-identity-signing.svg`. *"Identity is a keypair. There is no users table."*
4. **The agent UX** — Show `/06-mcp-bridge.svg`. *"This is how Claude does it without burning your wallet."*
5. **Where the money goes** — Show `/05-money-flow.svg`. *"Sub-cent micropayments. Mock and real share one wire format."*
6. **What ships today** — Show `/04-phases.svg`. *"144 of 144 tests green. 8 phases. Three audits run independently against fresh contexts."*

Total: 6 slides, ~5 minutes if you talk through them.
