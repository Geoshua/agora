// Deterministic-hash pseudo-embedding for service descriptions and
// query intents. See ADR 0007.
//
// Output: 384-dim Float32Array, L2-normalized. First 80 dims encode
// presence of anchor concepts; remaining dims encode hash-based
// features. Cosine similarity behaves like a fast, dependency-free
// semantic-search proxy.
//
// To upgrade to real embeddings later: replace the body of `embed()`
// with a @xenova/transformers call returning a Float32Array.

const ANCHORS = [
  // security / monitoring  (hi priority — these define the github-advisory service)
  "security", "vulnerability", "advisory", "advisories", "cve", "ghsa", "severity",
  "monitor", "monitoring", "watch", "watcher", "alert", "alerts", "subscribe",
  "subscription", "code", "github", "git", "repo", "repository",
  "package", "dependency", "patch", "exploit", "attack", "breach", "problem", "problems",
  "ship", "delivered", "scan", "scanning", "audit",
  // verification / geo
  "verify", "verification", "verified", "listing", "place", "location", "geo",
  "geocode", "osm", "openstreetmap", "coordinates", "address", "map", "city", "country",
  // audit / receipt
  "receipt", "delivery", "order", "proof", "signed", "signature",
  // dataset / data
  "dataset", "data", "weather", "noaa", "archive", "download", "file", "parquet",
  "csv", "history", "historical", "benchmark", "sample",
  // pricing / wallet
  "price", "cost", "lightning", "sats", "bitcoin", "wallet", "invoice",
  // misc
  "agent", "service", "endpoint", "task", "job", "fast",
];
// 80 anchors total. (Pad to exactly 80.)
while (ANCHORS.length < 80) ANCHORS.push(`_pad${ANCHORS.length}`);
ANCHORS.length = 80;

const DIM = 384;
const ANCHOR_DIMS = ANCHORS.length;
const FEAT_DIMS = DIM - ANCHOR_DIMS;

function tokenize(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Embed an arbitrary text into a 384-dim L2-normalized Float32Array. */
export function embed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  const tokens = tokenize(text);
  if (tokens.length === 0) return v;

  // Anchor presence with stem-prefix fallback. Anchor weight is large
  // so anchor matches dominate over hash-bigram noise.
  for (const tok of tokens) {
    for (let i = 0; i < ANCHOR_DIMS; i++) {
      const a = ANCHORS[i]!;
      if (tok === a) v[i] += 3.0;
      else if (tok.length >= 4 && a.length >= 4 && (tok.startsWith(a) || a.startsWith(tok))) v[i] += 1.5;
    }
  }

  // Hash-based bigram features in the remaining dims (weak signal).
  for (let i = 0; i < tokens.length; i++) {
    const uni = tokens[i]!;
    const h1 = fnv1a(uni) % FEAT_DIMS;
    v[ANCHOR_DIMS + h1] += 0.3;
    if (i + 1 < tokens.length) {
      const bi = `${uni}_${tokens[i + 1]!}`;
      const h2 = fnv1a(bi) % FEAT_DIMS;
      v[ANCHOR_DIMS + h2] += 0.4;
    }
  }

  // Length feature in last 4 dims.
  const lf = Math.min(1, tokens.length / 80);
  v[DIM - 1] = lf;

  // L2-normalize.
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) v[i]! /= norm;
  }
  return v;
}

/** Cosine similarity (vectors must already be normalized). */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Convert Float32Array → Buffer for SQLite BLOB storage. */
export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/** Reverse: Buffer → Float32Array. */
export function fromBlob(b: Buffer): Float32Array {
  // Copy to ensure alignment and independence from the source buffer.
  const copy = Buffer.from(b);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.length / 4);
}

export const EMBEDDING_DIM = DIM;
