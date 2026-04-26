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

await step("L402 macaroon format is byte-compat with provider's frozen format", async () => {
  const mod = await import(pathToFileURL(path.join(CORE, "dist/index.js")).href);
  const secret = "X".repeat(32);
  const body = { payment_hash: "ab", resource: "/r", amount: 1, exp: 99999999999 };
  const m = mod.mintMacaroon(body, secret);
  const [payload, sig] = m.split(".");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig !== expected) throw new Error("HMAC format diverged from provider's");
  // Also verify the payload is base64url(JSON(body)) — same as provider.
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (decoded.payment_hash !== body.payment_hash || decoded.amount !== body.amount) {
    throw new Error("payload encoding differs");
  }
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
