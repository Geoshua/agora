#!/usr/bin/env node
// Tauri shell — best-effort.
//
// If `cargo` is on PATH, this can be replaced by a real Tauri 2.x wrap
// via `cargo install tauri-cli && npm run tauri init` (one-time setup).
// Until then, the SPA runs identically under `npm run dashboard:dev`
// (Vite, port 5173) and the desktop wrap is a future-friendly addition.
//
// We detect cargo at runtime so this script:
//   - exits 0 if cargo is missing (CI stays green)
//   - prints actionable instructions to the human
//   - does not block the Phase 3-UI test gate

import { spawnSync } from "node:child_process";

const mode = process.argv[2] === "dev" ? "dev" : "build";

function hasCargo() {
  const r = spawnSync("cargo", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

if (!hasCargo()) {
  console.log(`Tauri ${mode}: skipped (Rust toolchain not installed).`);
  console.log("");
  console.log("To enable a Tauri desktop wrap of this SPA:");
  console.log("  1. Install Rust: https://rustup.rs/");
  console.log("  2. cargo install tauri-cli");
  console.log("  3. cd dashboard && npm run tauri init");
  console.log("");
  console.log("The dashboard runs identically as a browser SPA today:");
  console.log("  npm run dashboard           # vite dev on http://localhost:5173");
  console.log("  npm run dashboard:cli       # CLI session probe (legacy)");
  process.exit(0);
}

// cargo present — try a real Tauri call. We don't ship a Tauri config
// in this commit, so we delegate to `npm run tauri init` if missing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAURI_DIR = path.join(HERE, "..", "src-tauri");

if (!fs.existsSync(TAURI_DIR)) {
  console.log(`Tauri ${mode}: src-tauri/ not present. Initialise once:`);
  console.log("  cd dashboard && npm exec tauri init");
  console.log("Then re-run this command.");
  process.exit(0);
}

const cmd = mode === "dev" ? "dev" : "build";
const r = spawnSync("npx", ["tauri", cmd], { stdio: "inherit", shell: true });
process.exit(r.status ?? 0);
