// Smoke test for @andromeda/core. Runs against the built dist/.
// Exits 0 on pass, non-zero on failure.

import assert from "node:assert";
import {
  generateKeypair, pubkeyFor, signUtf8, verifyUtf8,
  signRequest, verifyRequest,
  mintMacaroon, verifyMacaroon, verifyPreimage, parseAuthHeader,
  validateReviewSubmission, rollupScore,
  DEFAULTS,
} from "../dist/index.js";

let pass = 0, total = 0;
async function it(name, fn) {
  total++;
  try { await fn(); pass++; console.log(`  ok · ${name}`); }
  catch (e) { console.error(`  FAIL · ${name}: ${e.message}`); }
}

console.log("@andromeda/core smoke");

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
  const sig = await signUtf8("hello andromeda", kp.privkey_hex);
  assert.strictEqual(sig.length, 128);
  assert.strictEqual(await verifyUtf8("hello andromeda", sig, kp.pubkey_hex), true);
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
  // Swap in another pubkey but keep A's signature.
  headers["x-andromeda-pubkey"] = kpB.pubkey_hex;
  const r = await verifyRequest({
    method: "GET", path: "/v1/x", body: "", headers,
  });
  assert.strictEqual(r.ok, false);
});

await it("L402 macaroon mint/verify roundtrip", () => {
  const secret = "X".repeat(32);
  const body = { payment_hash: "deadbeef", resource: "/v1/test", amount: 100, exp: Math.floor(Date.now() / 1000) + 60 };
  const m = mintMacaroon(body, secret);
  const v = verifyMacaroon(m, secret);
  assert.deepStrictEqual(v, body);
});

await it("L402 macaroon rejects bad secret", () => {
  const body = { payment_hash: "deadbeef", resource: "/v1/test", amount: 100, exp: Math.floor(Date.now() / 1000) + 60 };
  const m = mintMacaroon(body, "X".repeat(32));
  assert.strictEqual(verifyMacaroon(m, "Y".repeat(32)), null);
});

await it("L402 macaroon rejects expired", () => {
  const secret = "X".repeat(32);
  const body = { payment_hash: "deadbeef", resource: "/v1/test", amount: 100, exp: Math.floor(Date.now() / 1000) - 60 };
  const m = mintMacaroon(body, secret);
  assert.strictEqual(verifyMacaroon(m, secret), null);
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
