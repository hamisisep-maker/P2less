// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 4 (2026-08-19) — see
// docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md. The vision doc's "CRM phone
// != ERP phone" scenario: when the same logical field comes back with
// different values from different connected systems, resolve via a
// configured source-priority order rather than silently picking one, and
// say so explicitly (not resolved) when priority can't decide it either.
//
// Deliberately PURE, same discipline as capability-gate.ts — no DB calls.
//
// HONEST STATUS: this is real, tested logic with NO live caller yet. Every
// tenant in this platform today has exactly ONE connector per external
// system (see docs/SYSTEM-DISCOVERY-2026-08-19.md) — nothing currently
// queries two systems for the same field, so there is no live conflict to
// resolve. Wire this in the moment a tenant actually connects two systems
// with overlapping fields (e.g. a CRM and an ERP that both know a contact's
// phone number); building the caller before that scenario exists would be
// speculative machinery with nothing real to exercise it.
// ─────────────────────────────────────────────────────────────────────────────

export type FieldConflictCandidate = {
  value: string;
  /** Which connected system this value came from, e.g. "connector:school-erp". */
  source: string;
};

export type FieldConflictResolution =
  | { resolved: true; value: string; source: string; reason: "unanimous" | "priority" }
  | { resolved: false; reason: "no_candidates" | "no_priority_config" | "tied_priority"; candidates: FieldConflictCandidate[] };

/** `sourcePriority` is an ordered list, highest-priority source first — the
 *  organization's own configuration, never guessed. */
export function resolveFieldConflict(candidates: FieldConflictCandidate[], sourcePriority: string[]): FieldConflictResolution {
  if (candidates.length === 0) return { resolved: false, reason: "no_candidates", candidates };

  // Every system agrees — no real conflict, no priority config even needed.
  const uniqueValues = new Set(candidates.map((c) => c.value));
  if (uniqueValues.size === 1) return { resolved: true, value: candidates[0].value, source: candidates[0].source, reason: "unanimous" };

  if (sourcePriority.length === 0) return { resolved: false, reason: "no_priority_config", candidates };

  for (const src of sourcePriority) {
    const match = candidates.find((c) => c.source === src);
    if (match) return { resolved: true, value: match.value, source: match.source, reason: "priority" };
  }
  // None of the disagreeing candidates' sources appear in the priority list
  // at all — genuinely undecidable from configuration, needs a human.
  return { resolved: false, reason: "tied_priority", candidates };
}
