// Smoke test for @agora/core. Runs against the built dist/.
// Exits 0 on pass, non-zero on failure.

import assert from "node:assert";
import {
  generateKeypair, pubkeyFor, signUtf8, verifyUtf8,
  signRequest, verifyRequest,
  mintMacaroon, verifyMacaroon, verifyPreimage, parseAuthHeader,
  mintMacaroonLegacy, verifyMacaroonLegacy, verifyAuth, canonicalResource,
  challengeHeader,
  validateReviewSubmission, rollupScore,
  DEFAULTS,
  HDR_PUBKEY, HDR_TIMESTAMP, HDR_SIG,
  HDR_PUBKEY_ANDROMEDA, HDR_TIMESTAMP_ANDROMEDA, HDR_SIG_ANDROMEDA,
  HDR_PUBKEY_LUMEN, HDR_TIMESTAMP_LUMEN, HDR_SIG_LUMEN,
  readEnv, readEnvOr,
} from "../dist/index.js";

let pass = 0, total = 0;
async function it(name, fn) {
  total++;
  try { await fn(); pass++; console.log(`  ok · ${name}`); }
  catch (e) { console.error(`  FAIL · ${name}: ${e.message}`); }
}

console.log("@agora/core smoke");

await it("generateKeypair returns hex of correct length", async () => {
  const kp = await generateKeypair();
  assert.strictEqual(kp.privkey_hex.length, 64);
  assert.strictEqual(kp.pubkey_hex.length, 64);
});

await it("pubkeyFor is deterministic for a fixed seed", async () => {
  const kp = await generateKeypair();
  const derived = await pubkeyFor(kp.privkey_hex);
  assert.strictEqual(derived, kp.pubkey_hex);
});

await it("sign/verify utf8 roundtrip", async () => {
  const kp = await generateKeypair();
  const sig = await signUtf8("hello agora", kp.privkey_hex);
  assert.strictEqual(sig.length, 128);
  assert.strictEqual(await verifyUtf8("hello agora", sig, kp.pubkey_hex), true);
  assert.strictEqual(await verifyUtf8("tampered", sig, kp.pubkey_hex), false);
});

await it("verify rejects garbage signatures", async () => {
  const kp = await generateKeypair();
  assert.strictEqual(await verifyUtf8("x", "00".repeat(64), kp.pubkey_hex), false);
  assert.strictEqual(await verifyUtf8("x", "ab", kp.pubkey_hex), false);
});

await it("signed-request roundtrip — POST with body", async () => {
  const kp = await generateKeypair();
  const body = JSON.stringify({ hello: "world", n: 42 });
  const headers = await signRequest({
    method: "POST", path: "/v1/sellers/register",
    body, privkeyHex: kp.privkey_hex, pubkeyHex: kp.pubkey_hex,
  });
  const r = await verifyRequest({
    method: "POST", path: "/v1/sellers/register",
    body, headers,
  });
  assert.strictEqual(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  if (r.ok) assert.strictEqual(r.pubkey, kp.pubkey_hex);
});

await it("signed-request rejects body tampering", async () => {
  const kp = await generateKeypair();
  const headers = await signRequest({
    method: "POST", path: "/v1/sellers/register", body: "{}",
    privkeyHex: kp.privkey_hex, pubkeyHex: kp.pubkey_hex,
  });
  const r = await verifyRequest({
    method: "POST", path: "/v1/sellers/register",
    body: "{\"tampered\":true}", headers,
  });
  assert.strictEqual(r.ok, false);
});

await it("signed-request rejects path tampering", async () => {
  const kp = await generateKeypair();
  const headers = await signRequest({
    method: "POST", path: "/v1/safe", body: "",
    privkeyHex: kp.privkey_hex, pubkeyHex: kp.pubkey_hex,
  });
  const r = await verifyRequest({
    method: "POST", path: "/v1/EVIL", body: "", headers,
  });
  assert.strictEqual(r.ok, false);
});

await it("signed-request rejects expired timestamp (±5 min)", async () => {
  const kp = await generateKeypair();
  const stale = Date.now() - 10 * 60 * 1000; // 10 min ago
  const headers = await signRequest({
    method: "GET", path: "/v1/health", body: "",
    privkeyHex: kp.privkey_hex, pubkeyHex: kp.pubkey_hex,
    timestampMs: stale,
  });
  const r = await verifyRequest({
    method: "GET", path: "/v1/health", body: "", headers,
  });
  assert.strictEqual(r.ok, false);
});

await it("signed-request rejects future timestamp (±5 min)", async () => {
  const kp = await generateKeypair();
  const future = Date.now() + 10 * 60 * 1000;
  const headers = await signRequest({
    method: "GET", path: "/v1/health", body: "",
    privkeyHex: kp.privkey_hex, pubkeyHex: kp.pubkey_hex,
    timestampMs: future,
  });
  const r = await verifyRequest({
    method: "GET", path: "/v1/health", body: "", headers,
  });
  assert.strictEqual(r.ok, false);
});

await it("signed-request rejects flipped pubkey", async () => {
  const kpA = await generateKeypair();
  const kpB = await generateKeypair();
  const headers = await signRequest({
    method: "GET", path: "/v1/x", body: "",
    privkeyHex: kpA.privkey_hex, pubkeyHex: kpA.pubkey_hex,
  });
  // Swap in another pubkey but keep A's signature (canonical AGORA hdr).
  headers[HDR_PUBKEY] = kpB.pubkey_hex;
  const r = await verifyRequest({
    method: "GET", path: "/v1/x", body: "", headers,
  });
  assert.strictEqual(r.ok, false);
});

await it("signRequest emits canonical X-Agora-* headers", async () => {
  const kp = await generateKeypair();
  const headers = await signRequest({
    method: "GET", path: "/v1/x", body: "",
    privkeyHex: kp.privkey_hex, pubkeyHex: kp.pubkey_hex,
  });
  assert.ok(headers[HDR_PUBKEY], "missing x-agora-pubkey");
  assert.ok(headers[HDR_TIMESTAMP], "missing x-agora-timestamp");
  assert.ok(headers[HDR_SIG], "missing x-agora-sig");
  // Must NOT emit legacy headers.
  assert.strictEqual(headers[HDR_PUBKEY_ANDROMEDA], undefined);
  assert.strictEqual(headers[HDR_PUBKEY_LUMEN], undefined);
});

await it("verifyRequest accepts legacy X-Andromeda-* family", async () => {
  const kp = await generateKeypair();
  const ts = Date.now();
  const sig = await signUtf8(["GET", "/v1/legacy", "", String(ts)].join("\n"), kp.privkey_hex);
  const r = await verifyRequest({
    method: "GET", path: "/v1/legacy", body: "",
    headers: {
      [HDR_PUBKEY_ANDROMEDA]: kp.pubkey_hex,
      [HDR_TIMESTAMP_ANDROMEDA]: String(ts),
      [HDR_SIG_ANDROMEDA]: sig,
    },
  });
  assert.strictEqual(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  if (r.ok) assert.strictEqual(r.family, "andromeda");
});

await it("verifyRequest accepts legacy X-Lumen-* family", async () => {
  const kp = await generateKeypair();
  const ts = Date.now();
  const sig = await signUtf8(["GET", "/v1/legacy", "", String(ts)].join("\n"), kp.privkey_hex);
  const r = await verifyRequest({
    method: "GET", path: "/v1/legacy", body: "",
    headers: {
      [HDR_PUBKEY_LUMEN]: kp.pubkey_hex,
      [HDR_TIMESTAMP_LUMEN]: String(ts),
      [HDR_SIG_LUMEN]: sig,
    },
  });
  assert.strictEqual(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  if (r.ok) assert.strictEqual(r.family, "lumen");
});

await it("verifyRequest prefers AGORA family when multiple are present", async () => {
  const kpAgora = await generateKeypair();
  const kpAndro = await generateKeypair();
  const ts = Date.now();
  const sigAgora = await signUtf8(["GET", "/v1/x", "", String(ts)].join("\n"), kpAgora.privkey_hex);
  const sigAndro = await signUtf8(["GET", "/v1/x", "", String(ts)].join("\n"), kpAndro.privkey_hex);
  const r = await verifyRequest({
    method: "GET", path: "/v1/x", body: "",
    headers: {
      [HDR_PUBKEY]: kpAgora.pubkey_hex,
      [HDR_TIMESTAMP]: String(ts),
      [HDR_SIG]: sigAgora,
      [HDR_PUBKEY_ANDROMEDA]: kpAndro.pubkey_hex,
      [HDR_TIMESTAMP_ANDROMEDA]: String(ts),
      [HDR_SIG_ANDROMEDA]: sigAndro,
    },
  });
  assert.strictEqual(r.ok, true);
  if (r.ok) {
    assert.strictEqual(r.family, "agora");
    assert.strictEqual(r.pubkey, kpAgora.pubkey_hex);
  }
});

await it("readEnv prefers AGORA_*, falls back to ANDROMEDA_* then LUMEN_*", () => {
  const src = { LUMEN_X: "lumen", ANDROMEDA_X: "andro", AGORA_X: "agora" };
  assert.strictEqual(readEnv("X", { source: src }), "agora");
  assert.strictEqual(readEnv("X", { source: { ANDROMEDA_X: "andro", LUMEN_X: "lumen" } }), "andro");
  assert.strictEqual(readEnv("X", { source: { LUMEN_X: "lumen" } }), "lumen");
  assert.strictEqual(readEnv("X", { source: {} }), undefined);
  assert.strictEqual(readEnvOr("X", "fallback", { source: {} }), "fallback");
});

await it("L402 macaroon mint/verify roundtrip (MDK shape)", () => {
  const secret = "X".repeat(32);
  const body = { payment_hash: "deadbeef", resource: "POST:/v1/test", amount: 100, exp: Math.floor(Date.now() / 1000) + 60 };
  const m = mintMacaroon(body, secret);
  const v = verifyMacaroon(m, secret);
  assert.deepStrictEqual(v, body);
});

await it("L402 macaroon rejects bad secret", () => {
  const body = { payment_hash: "deadbeef", resource: "POST:/v1/test", amount: 100, exp: Math.floor(Date.now() / 1000) + 60 };
  const m = mintMacaroon(body, "X".repeat(32));
  assert.strictEqual(verifyMacaroon(m, "Y".repeat(32)), null);
});

await it("L402 MDK-shape verifier does NOT enforce expiry (paid credentials are permanent — MDK design)", () => {
  // Pre-ADR-0014, Agora's hand-rolled verifier rejected expired
  // macaroons. MDK chose to make paid credentials permanent — once a
  // preimage matches, the credential is forever valid. Single-use is
  // enforced separately by the seller's invoices table.
  const secret = "X".repeat(32);
  const body = { payment_hash: "deadbeef", resource: "POST:/v1/test", amount: 100, exp: Math.floor(Date.now() / 1000) - 60 };
  const m = mintMacaroon(body, secret);
  const v = verifyMacaroon(m, secret);
  assert.deepStrictEqual(v, body);
});

await it("L402 MDK-shape: tampered amount fails HMAC", () => {
  const secret = "X".repeat(32);
  const body = { payment_hash: "deadbeef", resource: "POST:/v1/test", amount: 100, exp: Math.floor(Date.now() / 1000) + 60 };
  const m = mintMacaroon(body, secret);
  // Decode, tamper with amountSats, re-encode without re-signing.
  const obj = JSON.parse(Buffer.from(m, "base64").toString());
  obj.amountSats = 1;
  const tampered = Buffer.from(JSON.stringify(obj)).toString("base64");
  assert.strictEqual(verifyMacaroon(tampered, secret), null);
});

await it("L402 soft-transition: legacy-format macaroon still verifies via verifyMacaroonLegacy", () => {
  const secret = "X".repeat(32);
  const body = { payment_hash: "deadbeef", resource: "POST:/v1/test", amount: 100, exp: Math.floor(Date.now() / 1000) + 60 };
  const legacy = mintMacaroonLegacy(body, secret);
  // Legacy verifier accepts old-format mints (with the body fields the
  // legacy mint serialized).
  const v = verifyMacaroonLegacy(legacy, secret);
  assert.deepStrictEqual(v, body);
  // MDK-shape verifier rejects legacy bytes (no `.` separator path,
  // not valid base64-of-JSON).
  assert.strictEqual(verifyMacaroon(legacy, secret), null);
});

await it("L402 verifyAuth: MDK-shape happy path", () => {
  const secret = "X".repeat(32);
  // 32 zero bytes; SHA256 hash known.
  const preimage = "00".repeat(32);
  const paymentHash = "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925";
  const resource = canonicalResource("POST", "/v1/test");
  const m = mintMacaroon({ payment_hash: paymentHash, resource, amount: 100, exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  const r = verifyAuth(`L402 ${m}:${preimage}`, resource, secret);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  if (r.ok) {
    assert.strictEqual(r.family, "mdk");
    assert.strictEqual(r.body.payment_hash, paymentHash);
  }
});

await it("L402 verifyAuth: legacy-shape falls through to legacy verifier", () => {
  const secret = "X".repeat(32);
  const preimage = "00".repeat(32);
  const paymentHash = "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925";
  const resource = canonicalResource("POST", "/v1/test");
  const m = mintMacaroonLegacy({ payment_hash: paymentHash, resource, amount: 100, exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  const r = verifyAuth(`L402 ${m}:${preimage}`, resource, secret);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  if (r.ok) assert.strictEqual(r.family, "legacy");
});

await it("L402 verifyAuth: rejects resource mismatch", () => {
  const secret = "X".repeat(32);
  const preimage = "00".repeat(32);
  const paymentHash = "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925";
  const m = mintMacaroon({ payment_hash: paymentHash, resource: "POST:/v1/A", amount: 100, exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  const r = verifyAuth(`L402 ${m}:${preimage}`, "POST:/v1/B", secret);
  assert.strictEqual(r.ok, false);
});

await it("L402 verifyAuth: rejects bad preimage", () => {
  const secret = "X".repeat(32);
  const paymentHash = "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925";
  const m = mintMacaroon({ payment_hash: paymentHash, resource: "POST:/v1/test", amount: 100, exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  const r = verifyAuth(`L402 ${m}:${"ff".repeat(32)}`, "POST:/v1/test", secret);
  assert.strictEqual(r.ok, false);
});

await it("L402 challengeHeader format matches bLIP-26", () => {
  assert.strictEqual(challengeHeader("MAC", "INV"), 'L402 macaroon="MAC", invoice="INV"');
});

await it("L402 parseAuthHeader accepts LSAT scheme (bLIP-26 backwards compat)", () => {
  assert.deepStrictEqual(parseAuthHeader("LSAT abc:def"), { macaroon: "abc", preimage: "def" });
});

await it("L402 verifyPreimage works", () => {
  // SHA256("") == e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  // but we need SHA256(32-byte-zero-buffer)
  const preimage = "00".repeat(32);
  // SHA256 of 32 zero bytes
  const expectedHash = "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925";
  assert.strictEqual(verifyPreimage(preimage, expectedHash), true);
  assert.strictEqual(verifyPreimage(preimage, "0".repeat(64)), false);
});

await it("L402 parseAuthHeader", () => {
  assert.deepStrictEqual(parseAuthHeader("L402 abc:def"), { macaroon: "abc", preimage: "def" });
  assert.strictEqual(parseAuthHeader(null), null);
  assert.strictEqual(parseAuthHeader("Bearer xyz"), null);
});

await it("review rubric validation catches missing scores", () => {
  const errs = validateReviewSubmission({ scores: { correctness: 5 }, justifications: {} });
  assert.ok(errs.length > 0);
});

await it("review rollupScore: all 5s = 5", () => {
  const scores = {
    correctness: 5, latency: 5, uptime: 5, spec_compliance: 5,
    value_for_price: 5, documentation: 5,
  };
  assert.strictEqual(rollupScore(scores), 5);
});

await it("DEFAULTS exports sensible numbers", () => {
  assert.ok(DEFAULTS.MAX_BUDGET_SATS > 0);
  assert.strictEqual(DEFAULTS.SIGNATURE_VALIDITY_MS, 5 * 60 * 1000);
});

console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
