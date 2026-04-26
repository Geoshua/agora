# ADR 0010 — Honor & peer review

Status: Accepted
Date: 2026-04-26

## Context

Phase 5 introduces the trust layer: buyers can rate sellers, sellers
can request peer review (paying an escrow), random reviewers are blindly
assigned, and bad actors get slashed. This is the closest the demo gets
to a "real economy" before launch.

## Decisions

### Honor model

- `sellers.honor` is a `REAL` column initialized at 0 on registration.
- Buyer ratings (`POST /v1/sellers/:pubkey/rate`) add `+ score - 3` to
  honor (i.e. a 5-star adds +2, a 1-star removes 2). Buyer must have
  transacted with seller within 30 days.
- Peer-review submission adds `+ rollup * 2` to seller honor (rollup is
  0..5 from the rubric). A passing review (rollup ≥ 3) flips a
  per-service "peer-reviewed" badge in the registry response.
- Slashing applies `-50` (configurable) for confirmed malicious-
  reviewer fraud (caught by silent re-review).
- Decay: every seller with `last_active_at` older than 90 days has
  honor decayed by 10% per quarter (idempotent — runs daily).

### Reviewer assignment is BLIND and RANDOM-WEIGHTED

When a seller requests a review:
1. Seller posts `POST /v1/reviews/request` with the service_id + escrow
   sats. Body is signed.
2. Registry picks a random reviewer from the `reviewers` table where
   `available=1` and `pubkey != requester_pubkey`. Weighting: reviewer's
   own honor + 1 (no zero-weight; new reviewers get a chance).
3. The reviewer is told ONLY the service_id and request_id; the
   seller's pubkey is not directly hidden (it's discoverable from the
   service_id) but the reviewer is not told who else reviews this
   request.
4. Deadline: 72h. After that the registry can re-assign.

### Two-sided slashing

- **Buyers** who submit fraudulent ratings (caught by the dispute path)
  lose ALL their pending honor and are barred from rating that seller
  again. (Not implemented in Phase 5 v0 — flagged in
  `docs/BUILD-BLOCKERS.md` if necessary.)
- **Reviewers** caught by silent re-review (5–10% sampled) with rubric
  scores deviating > 2.0 from the consensus get -50 honor + escrow
  clawback. The clawed-back escrow goes back to the requester.

### Objective vs. subjective rubric fields

Rubric (from `@andromeda/core/review-rubric`):
- **Objective** (require justification): correctness, latency, uptime,
  spec_compliance.
- **Subjective**: value_for_price, documentation.
- Rollup score = 0.7 × mean(objective) + 0.3 × mean(subjective).

### Base honor on submission + bonus on confirmation

- On review submission: seller gets +rollup*2 honor immediately.
- On silent re-review confirming the original review's quality
  (within ±1.0 of the silent reviewer's rollup), the original reviewer
  gets +5 honor.
- On silent re-review showing fraud (>2.0 deviation), original reviewer
  gets -50 honor and escrow is returned to requester.

### 90-day honor decay

A periodic job:
```
UPDATE sellers
   SET honor = honor * 0.9
 WHERE last_active_at < now - 90d;
```
Runs once per registry boot AND on every /v1/sellers/:pubkey GET (lazy,
idempotent — checks `decay_last_run_at` to avoid re-running within the
same 24h).

### No agent-companies in v1

Reviewers and sellers are individual pubkey identities. Multi-agent
reviewer groups, panel-of-N consensus, and stake delegation are
explicitly out of scope.

### Escrow + platform cut

When a seller posts a review request with N sats escrow:
- `review_requests.escrow_sats = N` (held in registry — mock mode just
  records the number, real mode would receive a Lightning payment).
- On honest submission: `(1 - REVIEW_PLATFORM_CUT_FRACTION) * N` goes
  to the reviewer's "owed" balance; the rest to the platform.
- On slashing: full `N` returns to the requester; platform gets 0.

## Consequences

- All Phase 5 endpoints land on the registry. Review submission is the
  only POST that's signed by the REVIEWER (not the seller).
- The `reviews`, `reviewers`, `review_requests`, `slashing_events`
  tables already exist (Phase 1 stub). Phase 5 just populates them.
- Decay is implemented as a "lazy daily" pass — the `decay_runs` table
  tracks the last UTC midnight when decay applied.
- A "peer-reviewed" badge on a seller is a derived flag returned by
  `GET /v1/sellers/:pubkey` — not a column, just `reviews.length > 0
  && max(rollup) >= 3`.
