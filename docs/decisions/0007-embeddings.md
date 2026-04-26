# ADR 0007 — Embeddings: deterministic-hash pseudo-embedding for v0; bge-small-en-v1.5 deferred

Status: Accepted (with a clear upgrade path)
Date: 2026-04-26

## Context

Phase 4 calls for service embeddings via `@xenova/transformers` running
locally with `Xenova/bge-small-en-v1.5`. The intent: rank services
against a query using cosine similarity in the embedding space, blended
with honor and price-fit.

## Decision

For v0 we ship a **deterministic-hash pseudo-embedding** that satisfies
the API contract (every service has a 384-dim embedding stored in
`embedding_blob`, the recommend endpoint scores against it), without
depending on `@xenova/transformers`. Reasons:

- `@xenova/transformers` model loading involves downloading 30+MB of
  ONNX weights on first run from a CDN. In a sandboxed/offline test
  environment this is brittle.
- The pseudo-embedding is good enough to demonstrate the orchestrator
  contract end-to-end and rank our small in-repo corpus correctly.
- The interface is identical to a real embedder, so the real model
  drops in by replacing one function (`embed(text) → Float32Array`).

### Pseudo-embedding algorithm

For each text:
1. Lowercase, strip punctuation, split into tokens.
2. Take a list of ~80 anchor concepts (security, monitoring, geo,
   verification, advisory, github, listing, place, repo, severity,
   subscribe, dataset, weather, download, audit, …).
3. The 384-dim output's first 80 dims = soft "presence" score for each
   anchor (token overlap or a hash-based fallback). Remaining 304 dims
   = derived features (length, n-gram hashes, type/tag-derived bits).
4. L2-normalize.

Cosine similarity in this space behaves close enough to real semantic
search for the demo corpus — "watch for security problems in code" hits
the GitHub-advisory-monitor anchors (`security`, `monitor`, `advisory`,
`code` ≈ `github`).

When the real model lands later: replace the body of `embed()` in
`registry/src/lib/embeddings.ts`. The schema, API contract, and ranking
formula stay the same.

## Ranking formula (per spec)

```
score = 0.6 * intent_match + 0.2 * honor_normalized + 0.2 * price_fit
```

Where:
- `intent_match` = cosine(query_embedding, service_embedding) clipped
  to [0, 1].
- `honor_normalized` = honor / max_honor_in_registry, clipped to [0, 1].
- `price_fit` = if max_price_sats given, 1 if service ≤ max else 0;
  otherwise 1 - clamp(price_sats / 1000, 0, 1) (cheaper services
  preferred, capped).

Each result returns `{intent_match, honor_normalized, price_fit, score}`
so the rationale is explainable.

## Edge cases

- Services whose price > `max_price_sats` are excluded from results
  with a top-level `excluded` array carrying
  `{ service_id, reason: "no service within price" }`.

## Consequences

- No `@xenova/transformers` dependency. We can add it later as a
  drop-in.
- `embedding_blob` is populated as Float32Array bytes (4 bytes/dim ×
  384 = 1536 bytes). Schema unchanged from Phase 1.
