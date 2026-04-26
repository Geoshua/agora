// Peer-review rubric — shared between registry and reviewer agents.
//
// Reviews score a service or seller on multiple objective + subjective
// fields. Rubric is finalised in ADR 0010 (Phase 5).

export const REVIEW_RUBRIC_FIELDS = [
  // objective
  "correctness",       // 0..5 — did the service produce a verifiably-correct answer?
  "latency",           // 0..5 — was p50 within advertised? 5 = within, 0 = >10x slower
  "uptime",            // 0..5 — did the service respond at all?
  "spec_compliance",   // 0..5 — does the response match the advertised schema?
  // subjective
  "value_for_price",   // 0..5
  "documentation",     // 0..5
] as const;

export type ReviewRubricField = (typeof REVIEW_RUBRIC_FIELDS)[number];

export const OBJECTIVE_FIELDS: ReadonlyArray<ReviewRubricField> = [
  "correctness", "latency", "uptime", "spec_compliance",
];

export const SUBJECTIVE_FIELDS: ReadonlyArray<ReviewRubricField> = [
  "value_for_price", "documentation",
];

export type ReviewSubmission = {
  /** Per-field 0..5 score. All fields required. */
  scores: Record<ReviewRubricField, number>;
  /** Per-field free-text justification. Required for objective fields. */
  justifications: Partial<Record<ReviewRubricField, string>>;
};

export function validateReviewSubmission(s: ReviewSubmission): string[] {
  const errors: string[] = [];
  for (const f of REVIEW_RUBRIC_FIELDS) {
    const v = s.scores[f];
    if (typeof v !== "number" || v < 0 || v > 5 || !Number.isFinite(v)) {
      errors.push(`scores.${f} must be a number 0..5`);
    }
  }
  for (const f of OBJECTIVE_FIELDS) {
    if (!s.justifications[f] || s.justifications[f]!.trim().length < 5) {
      errors.push(`justifications.${f} required (min 5 chars)`);
    }
  }
  return errors;
}

/** Roll up a 0..5 mean across fields, weighted toward objective. */
export function rollupScore(scores: Record<ReviewRubricField, number>): number {
  let obj = 0, sub = 0;
  for (const f of OBJECTIVE_FIELDS) obj += scores[f] ?? 0;
  for (const f of SUBJECTIVE_FIELDS) sub += scores[f] ?? 0;
  const objMean = obj / OBJECTIVE_FIELDS.length;
  const subMean = sub / SUBJECTIVE_FIELDS.length;
  // 70% objective, 30% subjective
  return objMean * 0.7 + subMean * 0.3;
}
