#!/usr/bin/env node
// ─── Phase 0 test gate ────────────────────────────────────────────────
// Verifies:
//   1. @agora/core typechecks (and legacy `packages/andromeda-core/`
//      reference is gone — ADR 0013)
//   2. @agora/core builds (dist/index.js exists)
//   3. @agora/core smoke tests pass (signed-request, L402, rubric,
//      header-family fallback, env-var fallback)
//   4. Macaroon HMAC byte-format unchanged (frozen)
//   5. ADRs 0001, 0002, 0003, 0013 exist
//   6. Workspace stubs exist (registry, dashboard, agents, web,
//      packages/agora-core)
//
// We do NOT run `npm run demo` here — that has its own gate. Run it
// explicitly. Phase-0 is for the foundation only.

import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(REPO, "packages", "agora-core");

let pass = 0, total = 0;
async function step(name, fn) {
  total++;
  process.stdout.write(`  · ${name} ... `);
  try {
    const r = await fn();
    if (r === false) { console.log("FAIL"); return; }
    pass++; console.log("ok");
  } catch (e) {
    console.log("FAIL");
    console.log(`      ${e.message}`);
  }
}

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, shell: true, encoding: "utf8" });
}

console.log("Phase 0 test gate");

await step("ADR 0001 exists", () => existsSync(path.join(REPO, "docs/decisions/0001-architecture-overview.md")));
await step("ADR 0002 (rebrand to Andromeda) exists", () => existsSync(path.join(REPO, "docs/decisions/0002-rebrand-lumen-to-andromeda.md")));
await step("ADR 0003 (workspace tool) exists", () => existsSync(path.join(REPO, "docs/decisions/0003-workspace-tool.md")));
await step("ADR 0013 (rebrand to Agora) exists", () => existsSync(path.join(REPO, "docs/decisions/0013-rebrand-andromeda-to-agora.md")));
await step(".nvmrc pins Node 20.x", () => {
  const v = readFileSync(path.join(REPO, ".nvmrc"), "utf8").trim();
  if (!v.startsWith("20.")) throw new Error(`expected 20.x, got ${v}`);
});
await step("tsconfig.base.json exists", () => existsSync(path.join(REPO, "tsconfig.base.json")));
await step("workspace dirs exist (registry, dashboard, agents, web, agora-core)", () => {
  for (const d of ["registry", "dashboard", "agents/market-monitor", "agents/dataset-seller", "web", "packages/agora-core"]) {
    if (!existsSync(path.join(REPO, d, "package.json"))) {
      throw new Error(`missing ${d}/package.json`);
    }
  }
});
await step("legacy packages/andromeda-core directory has been removed (ADR 0013)", () => {
  if (existsSync(path.join(REPO, "packages", "andromeda-core"))) {
    throw new Error("packages/andromeda-core still present; should be renamed to packages/agora-core");
  }
});
await step("root package.json declares workspaces with packages/agora-core", () => {
  const j = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
  if (!Array.isArray(j.workspaces) || j.workspaces.length === 0) {
    throw new Error("package.json.workspaces missing");
  }
  if (!j.workspaces.includes("packages/agora-core")) {
    throw new Error("workspaces array missing packages/agora-core");
  }
});

await step("@agora/core typechecks (tsc --noEmit)", () => {
  const r = run(path.join(REPO, "node_modules/.bin/tsc"), ["-p", "tsconfig.json", "--noEmit"], CORE);
  if (r.status !== 0) {
    throw new Error(`tsc failed:\n${r.stdout}\n${r.stderr}`);
  }
});

await step("@agora/core builds (tsc emit)", () => {
  const r = run(path.join(REPO, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], CORE);
  if (r.status !== 0) throw new Error(`tsc emit failed:\n${r.stdout}\n${r.stderr}`);
  if (!existsSync(path.join(CORE, "dist/index.js"))) throw new Error("dist/index.js missing");
});

await step("@agora/core smoke tests pass (signed-request, l402, rubric, header families, env fallback)", () => {
  const r = run("node", ["test/smoke.test.mjs"], CORE);
  if (r.status !== 0) {
    throw new Error(`smoke tests failed:\n${r.stdout}\n${r.stderr}`);
  }
  if (!r.stdout.includes("PASS · ")) throw new Error("smoke tests didn't print PASS");
});

await step("L402 macaroon byte-format is MDK-shape (ADR 0014)", async () => {
  // Per ADR 0014, the macaroon wire format is now MDK-shape:
  //   base64(JSON({paymentHash, amountSats, expiresAt, resource,
  //               amount, currency, sig}))
  // where sig = HMAC-SHA256(deriveL402Key(secret),
  //   paymentHash\0amountSats\0expiresAt\0resource\0amount\0currency).hex
  // and deriveL402Key(secret) = HMAC-SHA256(secret, "mdk402-token-v1").
  const mod = await import(pathToFileURL(path.join(CORE, "dist/index.js")).href);
  const secret = "X".repeat(32);
  const body = { payment_hash: "ab", resource: "POST:/r", amount: 1, exp: 99999999999 };
  const m = mod.mintMacaroon(body, secret);

  // 1. Bytes parse as base64-of-JSON, NOT the legacy `payload.sig` form.
  if (m.includes(".")) throw new Error(`MDK-shape macaroon must not contain '.' separator; got ${m}`);
  let parsed;
  try { parsed = JSON.parse(Buffer.from(m, "base64").toString("utf8")); }
  catch (e) { throw new Error(`macaroon is not base64-of-JSON: ${e.message}`); }

  // 2. Required fields are present in MDK camelCase.
  for (const k of ["paymentHash", "amountSats", "expiresAt", "resource", "amount", "currency", "sig"]) {
    if (!(k in parsed)) throw new Error(`missing required MDK field: ${k}`);
  }
  if (parsed.paymentHash !== body.payment_hash) throw new Error("paymentHash mismatch");
  if (parsed.amountSats !== body.amount) throw new Error("amountSats mismatch");
  if (parsed.expiresAt !== body.exp) throw new Error("expiresAt mismatch");
  if (parsed.resource !== body.resource) throw new Error("resource mismatch");

  // 3. Signature is HMAC-SHA256(deriveL402Key(secret), msg) hex.
  const key = createHmac("sha256", secret).update("mdk402-token-v1").digest();
  const message = [parsed.paymentHash, String(parsed.amountSats), String(parsed.expiresAt),
                   parsed.resource, String(parsed.amount), parsed.currency].join("\0");
  const expected = createHmac("sha256", key).update(message).digest("hex");
  if (parsed.sig !== expected) throw new Error("HMAC sig diverged from MDK format");
});

await step("L402 soft-transition: verifyAuth still parses legacy-format macaroons", async () => {
  // ADR 0014 §"Soft-transition verifier": one major-version cycle the
  // legacy `base64url(json).hmac` format is still accepted to keep
  // already-issued credentials working. Synthesize one and verify.
  const mod = await import(pathToFileURL(path.join(CORE, "dist/index.js")).href);
  const { createHash } = await import("node:crypto");
  const secret = "X".repeat(32);
  // 32-byte preimage of zeros; SHA256 hash known.
  const preimage = "00".repeat(32);
  const paymentHash = createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");
  const resource = "POST:/v1/test-legacy";
  const legacy = mod.mintMacaroonLegacy(
    { payment_hash: paymentHash, resource, amount: 42, exp: Math.floor(Date.now() / 1000) + 60 },
    secret,
  );
  const r = mod.verifyAuth(`L402 ${legacy}:${preimage}`, resource, secret);
  if (!r.ok) throw new Error(`legacy verifier rejected: ${r.reason}`);
  if (r.family !== "legacy") throw new Error(`expected family=legacy, got ${r.family}`);
});

await step("MCP env var fallback chain works (AGORA_PROVIDER_URL → ANDROMEDA_PROVIDER_URL → LUMEN_PROVIDER_URL)", () => {
  const src = readFileSync(path.join(REPO, "mcp/lumen-client.js"), "utf8");
  if (!src.includes("AGORA_PROVIDER_URL")) throw new Error("AGORA_PROVIDER_URL not read");
  if (!src.includes("ANDROMEDA_PROVIDER_URL")) throw new Error("ANDROMEDA_PROVIDER_URL fallback removed");
  if (!src.includes("LUMEN_PROVIDER_URL")) throw new Error("LUMEN_PROVIDER_URL fallback removed");
});

await step("Signed-request module exports both AGORA + ANDROMEDA + LUMEN header constants", async () => {
  const mod = await import(pathToFileURL(path.join(CORE, "dist/index.js")).href);
  for (const k of ["HDR_PUBKEY", "HDR_TIMESTAMP", "HDR_SIG",
                   "HDR_PUBKEY_ANDROMEDA", "HDR_TIMESTAMP_ANDROMEDA", "HDR_SIG_ANDROMEDA",
                   "HDR_PUBKEY_LUMEN", "HDR_TIMESTAMP_LUMEN", "HDR_SIG_LUMEN"]) {
    if (typeof mod[k] !== "string") throw new Error(`missing export ${k}`);
  }
  if (mod.HDR_PUBKEY !== "x-agora-pubkey") throw new Error(`canonical pubkey header should be x-agora-pubkey, got ${mod.HDR_PUBKEY}`);
});

console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
