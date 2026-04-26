#!/usr/bin/env node
// Andromeda dashboard CLI — placeholder for the Tauri GUI.
//
// Reads the MCP control-plane port + token from ~/.andromeda/, then
// fetches /session and prints a one-page summary. Useful while the
// real Tauri UI is deferred.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_DIR = path.join(os.homedir(), ".andromeda");
const PORT_FILE = path.join(STATE_DIR, "control-port");
const TOKEN_FILE = path.join(STATE_DIR, "control-token");

function read(p) {
  try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; }
}

async function main() {
  const port = read(PORT_FILE);
  const token = read(TOKEN_FILE);
  if (!port || !token) {
    console.error("Andromeda MCP control plane is not running.");
    console.error(`Expected: ${PORT_FILE} + ${TOKEN_FILE}`);
    console.error("Start the MCP server first: `node mcp/server.js`");
    process.exit(1);
  }
  console.log(`control plane: http://127.0.0.1:${port}`);
  console.log(`token (Authorization: Bearer …): ${token}`);
  console.log();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    console.log(JSON.stringify(j, null, 2));
  } catch (e) {
    console.error("control plane unreachable:", e.message);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
