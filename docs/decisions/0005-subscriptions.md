# ADR 0005 — Subscriptions: prepaid balance, polled alerts

Status: Accepted
Date: 2026-04-26

## Context

Phase 2 adds a "subscription" primitive: a buyer pays a prepaid balance
and consumes events at sat-per-event prices. The first subscriber is the
GitHub-advisory-monitor agent.

## Decisions

### Pricing model: prepaid balance, sat-per-event

Alternatives considered:
- **Invoice-per-event** — every alert ships its own L402 invoice. Simple
  but high friction; agents must hold an invoice loop.
- **Streaming sats (LSAT, Lightning streams)** — too far off the shelf.
- **Prepaid balance** — buyer deposits N sats, balance is debited per
  event. We picked this.

Subscriber pays a deposit (e.g. 1000 sat) at subscribe time. Each
delivered event debits `per_event_sats`. When balance < per_event_sats,
status flips to `exhausted` and a `balance_exhausted` event fires once.

### Alert delivery: polling, not push

Alternatives considered:
- **Webhook push** — needs the buyer to expose an HTTP endpoint;
  agent-style buyers rarely have one.
- **WebSocket / SSE** — keeps a connection alive; brittle behind sleep
  on a laptop.
- **Polling** — buyer calls `GET /api/v1/subscriptions/:id/alerts?since=...`.
  Simple, idempotent, no server-side state about delivery.

We pick polling. Each alert is signed by the seller (HMAC over the alert
body), so a third party can verify the alert is authentic.

### Watcher loop, fanned in

One watcher loop per subscription TYPE (not per subscription) inside the
provider. The loop fetches advisories on a fixed interval (60 s in real
mode, 5 s in mock mode), then for each new advisory iterates all active
subscriptions of that type and matches against their config (e.g.
`watched_repos`, `severity_min`).

If an advisory matches a sub, we:
1. Debit `per_event_sats` from balance (atomic).
2. If balance flips below 0, emit `balance_exhausted` once and mark
   subscription `exhausted`.
3. Otherwise insert an alert row tagged with the advisory id.

### Cancel returns balance

In mock mode: zero out the balance counter and mark `cancelled`.
In real mode: trigger an NWC `pay_invoice` back to the subscriber's
NWC if a `refund_invoice` is on file; otherwise zero out and log a
warning. (Real-mode refund implementation deferred — out of scope for
Phase 2's tests.)

### Top-up

`POST /api/v1/subscriptions/:id/topup { sats }` requires a 402 paywall
challenge (or a mock /api/dev/pay equivalent). On settled payment, add
to balance.

## Consequences

- One SQL table per concern: `subscriptions`, `subscription_alerts`.
- Subscriptions don't go through the registry's transaction ledger
  (Phase 1's tx ledger is for atomic L402 calls). Subscriptions track
  their own balance internally.
- The mock-mode `POST /api/dev/fire-alert` endpoint exists ONLY in
  mock mode and is gated by `MOCK_MODE=true`.
