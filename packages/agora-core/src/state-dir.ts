// Local state directory for Agora.
//
// Canonical path: ~/.agora/
// Legacy paths:   ~/.andromeda/  (ADR 0002), ~/.lumen/ (pre-Andromeda; never shipped)
//
// On first read we run a one-shot migration: if ~/.agora/ does not exist
// but ~/.andromeda/ does, copy its contents into ~/.agora/. The legacy
// directory is NOT deleted (working principle #10 — non-destructive).
//
// Override with AGORA_STATE_DIR (or ANDROMEDA_STATE_DIR / LUMEN_STATE_DIR).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEnv } from "./env.js";

const CANONICAL_NAME = ".agora";
const LEGACY_NAMES = [".andromeda"]; // .lumen never shipped

let _migrated = false;

/**
 * Returns the canonical state-dir path. Honours AGORA_STATE_DIR (with
 * legacy fallbacks). Performs a one-shot migration from ~/.andromeda/
 * to ~/.agora/ on first call, IF the override env is unset.
 */
export function stateDir(): string {
  const override = readEnv("STATE_DIR");
  if (override) return override;
  const target = path.join(os.homedir(), CANONICAL_NAME);
  if (!_migrated) {
    _migrated = true;
    runOneShotMigration(target);
  }
  return target;
}

/**
 * Returns a path inside the state directory. Ensures the parent exists.
 */
export function stateDirPath(...parts: string[]): string {
  const dir = stateDir();
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
  return path.join(dir, ...parts);
}

function runOneShotMigration(target: string): void {
  // Already migrated.
  if (fs.existsSync(target)) return;
  for (const legacy of LEGACY_NAMES) {
    const legacyDir = path.join(os.homedir(), legacy);
    if (!fs.existsSync(legacyDir)) continue;
    try {
      copyDirRecursive(legacyDir, target);
      // Best-effort marker so users know migration happened.
      try {
        fs.writeFileSync(
          path.join(target, "MIGRATED-FROM-ANDROMEDA"),
          `# Migrated from ${legacyDir} on ${new Date().toISOString()}\n# Old directory was preserved (not deleted) per ADR 0013.\n`,
          { mode: 0o600 },
        );
      } catch {}
      process.stderr.write(`[agora] migrated state directory: ${legacyDir} -> ${target}\n`);
      return;
    } catch (e) {
      process.stderr.write(`[agora] state-dir migration WARN: ${(e as Error).message}\n`);
    }
  }
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) {
      try { fs.copyFileSync(s, d); }
      catch (e) { process.stderr.write(`[agora] copy WARN ${s}: ${(e as Error).message}\n`); }
    }
  }
}

/** For tests: reset migration flag. */
export function _resetMigrationFlagForTest(): void { _migrated = false; }

export const STATE_DIR_NAME = CANONICAL_NAME;
export const LEGACY_STATE_DIR_NAMES = LEGACY_NAMES;
