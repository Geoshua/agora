#!/usr/bin/env node
// Stub for `tauri build`. The real Tauri 2.x GUI is deferred — see ADR
// 0006. This script returns 0 so CI / Phase 3's test gate can verify
// that the dashboard workspace is at least invocable.

console.log("Andromeda dashboard — Tauri GUI build deferred (ADR 0006).");
console.log("Control plane lives in the MCP server; run `npm run mcp` and");
console.log("then `npm run dashboard:cli` to see session state.");
process.exit(0);
