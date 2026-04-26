#!/usr/bin/env node
// ─── Phase 0 test gate ────────────────────────────────────────────────
// Verifies:
//   1. @andromeda/core typechecks
//   2. @andromeda/core builds (dist/index.js exists)
//   3. @andromeda/core smoke tests pass (signed-request, L402, rubric)
//   4. Macaroon HMAC byte-format unchanged (frozen)
//   5. ADRs 0001, 0002, 0003 exist
//   6. Workspace stubs exist
//
// We do NOT run `npm run demo` here — that has its own gate. Run it
// explicitly. Phase-0 is for the foundation only.

import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(REPO, "packages", "andromeda-core");

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
await step("ADR 0002 (rebrand) exists", () => existsSync(path.join(REPO, "docs/decisions/0002-rebrand-lumen-to-andromeda.md")));
await step("ADR 0003 (workspace tool) exists", () => existsSync(path.join(REPO, "docs/decisions/0003-workspace-tool.md")));
await step(".nvmrc pins Node 20.x", () => {
  const v = readFileSync(path.join(REPO, ".nvmrc"), "utf8").trim();
  if (!v.startsWith("20.")) throw new Error(`expected 20.x, got ${v}`);
});
await step("tsconfig.base.json exists", () => existsSync(path.join(REPO, "tsconfig.base.json")));
await step("workspace dirs exist (registry, dashboard, agents, web)", () => {
  for (const d of ["registry", "dashboard", "agents/market-monitor", "agents/dataset-seller", "web", "packages/andromeda-core"]) {
    if (!existsSync(path.join(REPO, d, "package.json"))) {
      throw new Error(`missing ${d}/package.json`);
    }
  }
});
await step("root package.json declares workspaces", () => {
  const j = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
  if (!Array.isArray(j.workspaces) || j.workspaces.length === 0) {
    throw new Error("package.json.workspaces missing");
  }
});

await step("@andromeda/core typechecks (tsc --noEmit)", () => {
  const r = run(path.join(REPO, "node_modules/.bin/tsc"), ["-p", "tsconfig.json", "--noEmit"], CORE);
  if (r.status !== 0) {
    throw new Error(`tsc failed:\n${r.stdout}\n${r.stderr}`);
  }
});

await step("@andromeda/core builds (tsc emit)", () => {
  const r = run(path.join(REPO, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], CORE);
  if (r.status !== 0) throw new Error(`tsc emit failed:\n${r.stdout}\n${r.stderr}`);
  if (!existsSync(path.join(CORE, "dist/index.js"))) throw new Error("dist/index.js missing");
});

await step("@andromeda/core smoke tests pass (signed-request, l402, rubric)", () => {
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

await step("MCP env var fallback chain works (ANDROMEDA_PROVIDER_URL → LUMEN_PROVIDER_URL)", () => {
  const src = readFileSync(path.join(REPO, "mcp/lumen-client.js"), "utf8");
  if (!src.includes("ANDROMEDA_PROVIDER_URL")) throw new Error("ANDROMEDA_PROVIDER_URL not read");
  if (!src.includes("LUMEN_PROVIDER_URL")) throw new Error("LUMEN_PROVIDER_URL fallback removed");
});

console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
