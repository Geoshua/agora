// Env-var resolution helpers for the Agora rebrand chain.
//
// Reads AGORA_* first, falls back to ANDROMEDA_*, then LUMEN_*. ADR 0013.
// Use this instead of bare `process.env.X` for any rebranded var.
//
// Examples:
//   readEnv("PROVIDER_URL") // tries AGORA_PROVIDER_URL → ANDROMEDA_PROVIDER_URL → LUMEN_PROVIDER_URL
//   readEnv("BUYER_PRIVKEY", { legacyOnly: ["ANDROMEDA"] }) // skip LUMEN
//
// Returns the first defined value (string, possibly empty), or undefined.

const PREFIXES = ["AGORA", "ANDROMEDA", "LUMEN"] as const;

export type EnvOpts = {
  /** Restrict the prefix lookup to the given list (default: all three). */
  prefixes?: ReadonlyArray<typeof PREFIXES[number]>;
  /** Use this env source (default: process.env). */
  source?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

/**
 * Read an Agora-namespaced env var with backward-compat fallbacks.
 * `bareName` is the suffix WITHOUT the prefix; we test each prefix in
 * order and return the first defined value.
 */
export function readEnv(bareName: string, opts: EnvOpts = {}): string | undefined {
  const src = opts.source ?? process.env;
  const prefixes = opts.prefixes ?? PREFIXES;
  for (const p of prefixes) {
    const v = src[`${p}_${bareName}`];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

/**
 * Like readEnv, but with a fallback default.
 */
export function readEnvOr(bareName: string, fallback: string, opts: EnvOpts = {}): string {
  return readEnv(bareName, opts) ?? fallback;
}

/**
 * Returns the canonical AGORA_* name for a given bare name. Useful for
 * logging / debugging.
 */
export function canonicalEnvName(bareName: string): string {
  return `AGORA_${bareName}`;
}

export const ENV_PREFIXES = PREFIXES;
