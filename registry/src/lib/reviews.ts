// Phase 5: honor + peer-review primitives.

import { db } from "./db";
import { randomUUID, createHash, createHmac } from "node:crypto";

const PLATFORM_CUT = 0.05;
const SLASH_DELTA = -50;

// ─── helpers ─────────────────────────────────────────────────────────
function pickRandomReviewer(excludePubkey: string): { pubkey: string; honor: number } | null {
  const rows = db().prepare(`
    SELECT r.pubkey, COALESCE(s.honor, 0) AS honor
      FROM reviewers r
      LEFT JOIN sellers s ON s.pubkey = r.pubkey
     WHERE r.available = 1 AND r.pubkey != ?
  `).all(excludePubkey) as Array<{ pubkey: string; honor: number }>;
  if (rows.length === 0) return null;
  // Weighted random. weight = max(1, honor + 1).
  const weights = rows.map(r => Math.max(1, (r.honor ?? 0) + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * total;
  for (let i = 0; i < rows.length; i++) {
    pick -= weights[i]!;
    if (pick <= 0) return rows[i]!;
  }
  return rows[rows.length - 1]!;
}

// ─── reviewers ───────────────────────────────────────────────────────
export function setReviewerAvailability(pubkey: string, available: boolean) {
  db().prepare(`
    INSERT INTO reviewers (pubkey, available, last_assigned_at)
    VALUES (?, ?, NULL)
    ON CONFLICT(pubkey) DO UPDATE SET available = excluded.available
  `).run(pubkey, available ? 1 : 0);
}

export function getReviewerAssignments(pubkey: string) {
  return db().prepare(`
    SELECT id, requester_pubkey, subject_pubkey, service_id, escrow_sats,
           status, deadline_at, created_at
      FROM review_requests
     WHERE reviewer_pubkey = ? AND status = 'assigned'
     ORDER BY created_at DESC
  `).all(pubkey);
}

// ─── ratings ─────────────────────────────────────────────────────────
export function rateSeller(args: {
  buyer_pubkey: string;
  seller_pubkey: string;
  stars: number;     // 1..5
}): { ok: true; new_honor: number } | { ok: false; reason: string } {
  if (args.stars < 1 || args.stars > 5) return { ok: false, reason: "stars must be 1..5" };
  // Verify the buyer transacted with the seller within 30 days.
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const tx = db().prepare(`
    SELECT id FROM transactions
     WHERE buyer_pubkey = ? AND seller_pubkey = ? AND settled_at >= ?
     LIMIT 1
  `).get(args.buyer_pubkey, args.seller_pubkey, cutoff);
  if (!tx) return { ok: false, reason: "no transaction with this seller in the last 30 days" };

  // Apply: honor += (stars - 3)
  const delta = args.stars - 3;
  db().prepare(`UPDATE sellers SET honor = honor + ? WHERE pubkey = ?`).run(delta, args.seller_pubkey);
  const r = db().prepare(`SELECT honor FROM sellers WHERE pubkey = ?`).get(args.seller_pubkey) as { honor: number } | undefined;
  return { ok: true, new_honor: r?.honor ?? 0 };
}

// ─── review request flow ────────────────────────────────────────────
export function requestReview(args: {
  requester_pubkey: string;     // = subject (the seller asking for review of itself)
  service_id?: string;
  escrow_sats: number;
}): { ok: true; request_id: string; reviewer_pubkey: string } | { ok: false; reason: string } {
  const reviewer = pickRandomReviewer(args.requester_pubkey);
  if (!reviewer) return { ok: false, reason: "no reviewers available" };
  const id = `rev_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const now = Date.now();
  const deadline = now + 72 * 3600 * 1000;
  db().prepare(`
    INSERT INTO review_requests (id, requester_pubkey, subject_pubkey, service_id, escrow_sats, reviewer_pubkey, status, deadline_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'assigned', ?, ?)
  `).run(id, args.requester_pubkey, args.requester_pubkey, args.service_id ?? null, args.escrow_sats, reviewer.pubkey, deadline, now);
  db().prepare(`UPDATE reviewers SET last_assigned_at = ? WHERE pubkey = ?`).run(now, reviewer.pubkey);
  return { ok: true, request_id: id, reviewer_pubkey: reviewer.pubkey };
}

export function submitReview(args: {
  request_id: string;
  reviewer_pubkey: string;
  scores: Record<string, number>;
  justifications: Record<string, string>;
  rollup: number;
}): { ok: true; review_id: string; reviewer_payout_sats: number; platform_cut_sats: number; new_honor: number }
   | { ok: false; reason: string } {
  const req = db().prepare(`SELECT * FROM review_requests WHERE id = ?`).get(args.request_id) as
    | { id: string; requester_pubkey: string; subject_pubkey: string; reviewer_pubkey: string;
        escrow_sats: number; status: string; service_id: string | null } | undefined;
  if (!req) return { ok: false, reason: "no such review request" };
  if (req.reviewer_pubkey !== args.reviewer_pubkey) return { ok: false, reason: "you are not the assigned reviewer" };
  if (req.status !== "assigned") return { ok: false, reason: `review request is ${req.status}, not assigned` };

  const review_id = `rvw_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const now = Date.now();
  db().prepare(`
    INSERT INTO reviews (id, subject_pubkey, reviewer_pubkey, request_id, scores_json, justifications_json, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(review_id, req.subject_pubkey, args.reviewer_pubkey, req.id,
         JSON.stringify(args.scores), JSON.stringify(args.justifications), now);

  // Apply honor: +rollup*2 to subject seller.
  const honorDelta = args.rollup * 2;
  db().prepare(`UPDATE sellers SET honor = honor + ? WHERE pubkey = ?`).run(honorDelta, req.subject_pubkey);

  // Escrow split.
  const platform_cut = Math.round(req.escrow_sats * PLATFORM_CUT);
  const reviewer_payout = req.escrow_sats - platform_cut;

  db().prepare(`UPDATE review_requests SET status = 'submitted', resolved_at = ? WHERE id = ?`).run(now, req.id);

  const r = db().prepare(`SELECT honor FROM sellers WHERE pubkey = ?`).get(req.subject_pubkey) as { honor: number } | undefined;
  return { ok: true, review_id, reviewer_payout_sats: reviewer_payout, platform_cut_sats: platform_cut, new_honor: r?.honor ?? 0 };
}

// ─── slashing ────────────────────────────────────────────────────────
export function slashReviewer(args: {
  request_id: string;
  reviewer_pubkey: string;
  reason: string;
  evidence: Record<string, unknown>;
  signing_secret: string;
}): { ok: true; honor_delta: number; escrow_returned: number; event_id: string }
   | { ok: false; reason: string } {
  const req = db().prepare(`SELECT * FROM review_requests WHERE id = ?`).get(args.request_id) as
    | { id: string; requester_pubkey: string; reviewer_pubkey: string; escrow_sats: number; status: string } | undefined;
  if (!req) return { ok: false, reason: "no such review request" };
  if (req.reviewer_pubkey !== args.reviewer_pubkey) return { ok: false, reason: "reviewer mismatch" };

  // Slash honor.
  db().prepare(`
    INSERT INTO sellers (pubkey, name, url, honor, registered_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(pubkey) DO UPDATE SET honor = honor + ?
  `).run(args.reviewer_pubkey, "(slashed reviewer)", "", SLASH_DELTA, Date.now(), Date.now(), SLASH_DELTA);

  const event_id = `slash_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const evidence_json = JSON.stringify(args.evidence);
  // Sign the audit log entry with HMAC using the registry's secret.
  const sig = createHmac("sha256", args.signing_secret)
    .update(`${event_id}|${args.reviewer_pubkey}|${args.reason}|${evidence_json}`)
    .digest("base64url");
  db().prepare(`
    INSERT INTO slashing_events (id, target_pubkey, reason, evidence_json, honor_delta, signature, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(event_id, args.reviewer_pubkey, args.reason, evidence_json, SLASH_DELTA, sig, Date.now());

  // Mark review request as slashed and clawback escrow (escrow returns to requester).
  db().prepare(`UPDATE review_requests SET status = 'slashed', resolved_at = ? WHERE id = ?`).run(Date.now(), req.id);
  // (mock: just record. real: trigger NWC payback.)
  return { ok: true, honor_delta: SLASH_DELTA, escrow_returned: req.escrow_sats, event_id };
}

// ─── decay ───────────────────────────────────────────────────────────
const DAY_MS = 24 * 3600 * 1000;
const NINETY_DAYS_MS = 90 * DAY_MS;

export function maybeRunDecay(): { ran: boolean; affected: number } {
  // Run at most once per UTC day.
  const last = db().prepare(`SELECT ran_at FROM decay_runs ORDER BY ran_at DESC LIMIT 1`).get() as { ran_at: number } | undefined;
  if (last && Date.now() - last.ran_at < DAY_MS) return { ran: false, affected: 0 };

  const cutoff = Date.now() - NINETY_DAYS_MS;
  const r = db().prepare(`UPDATE sellers SET honor = honor * 0.9 WHERE last_active_at < ? AND honor != 0`).run(cutoff);
  db().prepare(`INSERT INTO decay_runs (ran_at, affected_count) VALUES (?, ?)`).run(Date.now(), r.changes);
  return { ran: true, affected: r.changes };
}

/** Force-run decay regardless of last run time. Used by tests. */
export function forceRunDecay(): { affected: number } {
  const cutoff = Date.now() - NINETY_DAYS_MS;
  const r = db().prepare(`UPDATE sellers SET honor = honor * 0.9 WHERE last_active_at < ? AND honor != 0`).run(cutoff);
  db().prepare(`INSERT INTO decay_runs (ran_at, affected_count) VALUES (?, ?)`).run(Date.now(), r.changes);
  return { affected: r.changes };
}

/** Return badges for a seller — derivable from reviews. */
export function sellerBadges(pubkey: string): { peer_reviewed: boolean; review_count: number; max_rollup: number } {
  const rows = db().prepare(`SELECT scores_json FROM reviews WHERE subject_pubkey = ?`).all(pubkey) as { scores_json: string }[];
  let max = 0;
  for (const r of rows) {
    try {
      const s = JSON.parse(r.scores_json) as Record<string, number>;
      const obj = ["correctness", "latency", "uptime", "spec_compliance"].map(f => s[f] ?? 0);
      const sub = ["value_for_price", "documentation"].map(f => s[f] ?? 0);
      const rollup = 0.7 * (obj.reduce((a, b) => a + b, 0) / 4) + 0.3 * (sub.reduce((a, b) => a + b, 0) / 2);
      if (rollup > max) max = rollup;
    } catch {}
  }
  return {
    peer_reviewed: rows.length > 0 && max >= 3,
    review_count: rows.length,
    max_rollup: max,
  };
}
