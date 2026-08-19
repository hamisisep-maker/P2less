// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 5 (2026-08-19) — see
// docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md and
// docs/PHASE5-WORKFLOW-ENGINE-SUBROADMAP-2026-08-19.md.
//
// This captures ONLY the genuinely shared shape across conversation.ts's 12+
// `awaiting_*` state handlers (confirmed by direct reading, not guessed):
// on each turn, is the message a plausible answer to what we're waiting for?
// If not, is it a confident enough topic switch to abandon this flow and
// follow it instead? If not that either, is this push-back or a repeated
// stray message (abandon), or a genuine first aside (answer it, then
// re-ask)? That four-way decision is IDENTICAL in shape across every flow —
// what differs per flow (deliberately, not by accident — e.g. the reroute
// confidence threshold is 0.55 in awaiting_param vs 0.6 in awaiting_confirm,
// because a slot-filling reroute is cheaper to get wrong than abandoning a
// pending payment confirmation) is supplied as config, never hard-coded here.
//
// Deliberately PURE, same discipline as capability-gate.ts/field-conflict.ts.
// The reroute check itself (an async understand() call) and the actual
// reply text stay with the caller — this function only decides WHICH of the
// four paths applies, given the caller has already done that async work.
//
// HONEST STATUS: this is the reusable PRIMITIVE only. It is NOT wired into
// any of conversation.ts's existing awaiting_* handlers — migrating those is
// real, high-regression-risk work on flows hardened through many prior
// live-bug fixes (the CONFIRM false-positive fix, the anti-nag fix, the
// quantity-assumption fix, and others), and this local dev environment's
// connector baseUrls are hardcoded to a port this preview harness doesn't
// actually run on (confirmed while investigating this phase — every
// connector-execution-dependent E2E test fails here for that reason, not a
// code defect), which rules out getting full local regression confidence
// before attempting a migration. See the sub-roadmap doc for the deferred
// migration plan and what needs to be true before it starts.
// ─────────────────────────────────────────────────────────────────────────────

export type WorkflowAskConfig = {
  /** Minimum intent-match confidence to treat the message as a genuine topic
   *  switch. Stays per-flow (see file header) — never a single global constant. */
  rerouteThreshold: number;
  /** How many non-answer asides to tolerate before abandoning the flow.
   *  Every existing flow uses 2 (answer the first stray message and re-ask,
   *  abandon on the second) — kept as an explicit default, not implicit. */
  maxAsides?: number;
};

export type WorkflowDecision =
  | { kind: "answered" }
  | { kind: "reroute" }
  | { kind: "reask"; asidesSoFar: number }
  | { kind: "abandon"; dueTo: "pushback" | "asides_exhausted" };

/** `plausibleAnswer`: did THIS message look like a real answer to what we're
 *  waiting for (caller already checked — e.g. extractDate()/extractTime()).
 *  `rerouteConfident`: did understand() return a different, confident-enough
 *  action match (caller already called understand() and compared the score
 *  to config.rerouteThreshold, since that's an async DB/AI call this
 *  function can't make). `isPushback`: caller already ran its PUSHBACK regex.
 *  `asidesSoFar`: the ConvContext.paramAsides-equivalent counter BEFORE this
 *  turn. */
export function evaluateWorkflowAsk(
  input: { plausibleAnswer: boolean; rerouteConfident: boolean; isPushback: boolean; asidesSoFar: number },
  config: WorkflowAskConfig,
): WorkflowDecision {
  if (input.plausibleAnswer) return { kind: "answered" };
  if (input.rerouteConfident) return { kind: "reroute" };
  if (input.isPushback) return { kind: "abandon", dueTo: "pushback" };
  const asidesSoFar = input.asidesSoFar + 1;
  const maxAsides = config.maxAsides ?? 2;
  if (asidesSoFar >= maxAsides) return { kind: "abandon", dueTo: "asides_exhausted" };
  return { kind: "reask", asidesSoFar };
}
