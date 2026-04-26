// MCP-side wrapper around @agora/core's state-dir helper.
//
// The @agora/core import is async via dynamic import in some places;
// this module gives us a sync API that all the MCP files (budget,
// transactions-log, subscriptions, control-plane) can use.
//
// Honours AGORA_STATE_DIR > ANDROMEDA_STATE_DIR > LUMEN_STATE_DIR.
// On first call, if ~/.agora/ does not exist but ~/.andromeda/ does,
// copies its contents into ~/.agora/ (one-shot migration; legacy dir
// preserved). ADR 0013.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CANONICAL_NAME = ".agora";
const LEGACY_NAMES = [".andromeda"];

let _migrated = false;

function envOverride() {
  return (
    process.env.AGORA_STATE_DIR ??
    process.env.ANDROMEDA_STATE_DIR ??
    process.env.LUMEN_STATE_DIR ??
    null
  );
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) {
      try { fs.copyFileSync(s, d); } catch (e) {
        process.stderr.write(`[agora-mcp] copy WARN ${s}: ${e.message}\n`);
      }
    }
  }
}

function runOneShotMigration(target) {
  if (fs.existsSync(target)) return;
  for (const legacy of LEGACY_NAMES) {
    const legacyDir = path.join(os.homedir(), legacy);
    if (!fs.existsSync(legacyDir)) continue;
    try {
      copyDirRecursive(legacyDir, target);
      try {
        fs.writeFileSync(
          path.join(target, "MIGRATED-FROM-ANDROMEDA"),
          `# Migrated from ${legacyDir} on ${new Date().toISOString()}\n# Old directory was preserved (not deleted) per ADR 0013.\n`,
          { mode: 0o600 },
        );
      } catch {}
      process.stderr.write(`[agora-mcp] migrated state dir: ${legacyDir} -> ${target}\n`);
      return;
    } catch (e) {
      process.stderr.write(`[agora-mcp] state-dir migration WARN: ${e.message}\n`);
    }
  }
}

export function stateDir() {
  const o = envOverride();
  if (o) return o;
  const target = path.join(os.homedir(), CANONICAL_NAME);
  if (!_migrated) {
    _migrated = true;
    runOneShotMigration(target);
  }
  return target;
}

export function stateDirPath(...parts) {
  const dir = stateDir();
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
  return path.join(dir, ...parts);
}

export const STATE_DIR_NAME = CANONICAL_NAME;
