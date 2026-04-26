#!/usr/bin/env node
// Phase 7 test gate — public web index.
//
// Spawns the web app via `next start -p 3300` against the live registry
// on 3030, fetches all 7 page types, and verifies each returns 200 with
// expected markers. Also verifies 404 paths return 404 (not 500), the
// production build exits clean, and rendered HTML is free of obvious
// JS errors.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_URL = process.env.ANDROMEDA_REGISTRY_URL ?? "http://localhost:3030";
const WEB_URL = "http://localhost:3300";

let pass = 0,
  total = 0;
const ok = (n) => {
  pass++;
  total++;
  console.log(`  ok · ${n}`);
};
const ko = (n) => {
  total++;
  console.log(`  FAIL · ${n}`);
};

async function fetchText(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  return { status: r.status, text };
}

function hasMarker(text, marker) {
  if (marker instanceof RegExp) return marker.test(text);
  return text.includes(marker);
}

function looksLikeJsError(text) {
  // Basic regex sanity: no raw `<script>throw` or unhandled error blocks
  // emitted into the static markup. Next.js error pages contain
  // "Application error" / "internal-error" markers — flag those.
  if (/<script[^>]*>\s*throw\b/.test(text)) return "raw <script>throw> in markup";
  if (/Application error: a server-side exception/i.test(text))
    return "Next.js server-side exception page";
  if (/__next_error__/.test(text) && /500/.test(text))
    return "Next.js 500 error page";
  return null;
}

async function waitFor(url, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* not yet */
    }
    await sleep(750);
  }
  return false;
}

async function main() {
  console.log("Phase 7 test gate (public web index)\n");

  // 0. Registry must be reachable.
  const rh = await fetch(`${REGISTRY_URL}/api/v1/health`).catch(() => null);
  if (!rh || !rh.ok) {
    console.log(
      `  FAIL · registry not reachable at ${REGISTRY_URL} (start it with \`npm run registry\`)`
    );
    console.log(`\nFAIL · 0/1`);
    process.exit(1);
  }
  ok(`registry reachable at ${REGISTRY_URL}`);

  // 1. Production build exits clean.
  console.log("\n  · npm --workspace=web run build …");
  await new Promise((resolve, reject) => {
    const p = spawn("npm", ["--workspace=web", "run", "build"], {
      cwd: REPO,
      shell: true,
      stdio: "pipe",
    });
    let stderr = "";
    p.stdout.on("data", () => {});
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("exit", (code) => {
      if (code === 0) {
        ok(`web build clean`);
        resolve();
      } else {
        ko(`web build failed (exit ${code})`);
        console.error(stderr.slice(0, 500));
        reject(new Error("build failed"));
      }
    });
  });

  // 2. Spawn `next start -p 3300`.
  const web = spawn("npm", ["--workspace=web", "run", "start"], {
    cwd: REPO,
    shell: true,
    env: { ...process.env, ANDROMEDA_REGISTRY_URL: REGISTRY_URL },
    stdio: "pipe",
  });
  web.stdout.on("data", () => {});
  web.stderr.on("data", () => {});

  try {
    const up = await waitFor(`${WEB_URL}/`, 60000);
    if (!up) {
      ko(`web did not come up on ${WEB_URL} in 60s`);
      throw new Error("web boot");
    }
    ok(`web up at ${WEB_URL}`);

    // 3. Fetch all 7 page types and verify markers.
    const sellers = await (await fetch(`${REGISTRY_URL}/api/v1/sellers`)).json();
    const services = await (
      await fetch(`${REGISTRY_URL}/api/v1/services`)
    ).json();
    if (!sellers.sellers?.length || !services.services?.length) {
      ko(`registry has no live data — seed it with provider/agents first`);
      throw new Error("no data");
    }
    const visionPk = sellers.sellers.find(
      (s) => s.name === "vision-oracle-3"
    )?.pubkey;
    const listingId = services.services.find(
      (s) => s.local_id === "listing-verify"
    )?.id;

    const probes = [
      {
        name: "/",
        url: `${WEB_URL}/`,
        markers: [/Andromeda/, /Featured services/, /How it works/],
      },
      {
        name: "/sellers",
        url: `${WEB_URL}/sellers`,
        markers: ["vision-oracle-3"],
      },
      {
        name: "/sellers/[pubkey]",
        url: `${WEB_URL}/sellers/${visionPk}`,
        markers: ["vision-oracle-3", "listing-verify"],
      },
      {
        name: "/services",
        url: `${WEB_URL}/services`,
        markers: ["listing-verify"],
      },
      {
        name: "/services/[id]",
        url: `${WEB_URL}/services/${encodeURIComponent(listingId)}`,
        markers: ["Listing verification", /Endpoint/, /Sold by/],
      },
      {
        name: "/search?q=listing",
        url: `${WEB_URL}/search?q=listing`,
        markers: ["Listing verification", /Tried recommend/],
      },
      {
        name: "/recommend?intent=verify+listing",
        url: `${WEB_URL}/recommend?intent=verify+a+listing`,
        markers: [/intent_match/, /price_fit/],
      },
    ];

    for (const p of probes) {
      try {
        const { status, text } = await fetchText(p.url);
        if (status !== 200) {
          ko(`${p.name} → HTTP ${status}`);
          continue;
        }
        const missing = p.markers.filter((m) => !hasMarker(text, m));
        if (missing.length > 0) {
          ko(
            `${p.name} → missing markers: ${missing.map((m) => String(m)).join(", ")}`
          );
          continue;
        }
        const err = looksLikeJsError(text);
        if (err) {
          ko(`${p.name} → JS-error sanity failed: ${err}`);
          continue;
        }
        ok(`${p.name} → 200, markers OK`);
      } catch (e) {
        ko(`${p.name} → fetch threw: ${e.message}`);
      }
    }

    // 4. 404 paths return 404 (not 500).
    const fakePk = "00".repeat(32); // 64-char hex pubkey that won't exist
    const probe404 = [
      {
        name: "/sellers/<bogus>",
        url: `${WEB_URL}/sellers/${fakePk}`,
      },
      {
        name: "/services/<bogus>",
        url: `${WEB_URL}/services/no-such-service-id-xyz`,
      },
    ];
    for (const p of probe404) {
      try {
        const r = await fetch(p.url, { signal: AbortSignal.timeout(15000) });
        if (r.status === 404) ok(`${p.name} → 404 (not 500)`);
        else ko(`${p.name} → HTTP ${r.status} (expected 404)`);
      } catch (e) {
        ko(`${p.name} → fetch threw: ${e.message}`);
      }
    }

    // 5. Sitemap renders without throwing.
    try {
      const r = await fetch(`${WEB_URL}/sitemap.xml`);
      if (r.ok) ok(`/sitemap.xml → 200`);
      else ko(`/sitemap.xml → HTTP ${r.status}`);
    } catch (e) {
      ko(`/sitemap.xml threw: ${e.message}`);
    }

    // 6. robots.txt is served.
    try {
      const r = await fetch(`${WEB_URL}/robots.txt`);
      const t = await r.text();
      if (r.ok && /User-agent: \*/i.test(t)) ok(`/robots.txt served`);
      else ko(`/robots.txt failed: HTTP ${r.status}`);
    } catch (e) {
      ko(`/robots.txt threw: ${e.message}`);
    }
  } finally {
    // Tear down web. Try graceful, then force.
    try {
      web.kill();
    } catch {
      /* ignore */
    }
    await sleep(800);
    try {
      // On Windows, npm spawns intermediate cmd.exe; orphaned `next-server`
      // can keep port 3300 bound. Best-effort cleanup so a re-run works.
      if (process.platform === "win32") {
        spawn("powershell", [
          "-NoProfile",
          "-Command",
          "Get-NetTCPConnection -LocalPort 3300 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
        ], { stdio: "ignore" }).on("exit", () => {});
        await sleep(600);
      }
    } catch {
      /* ignore */
    }
  }

  console.log(`\n${pass === total ? "PASS" : "FAIL"} · ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e.stack || e.message);
  console.log(`\nFAIL · ${pass}/${Math.max(total, pass + 1)}`);
  process.exit(1);
});
