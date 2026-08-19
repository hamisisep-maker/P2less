import { hasPermission } from "./permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 3 (2026-08-19) — see
// docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md. The vision doc's "can AI do
// this → authorized → confirm → execute" ladder, made an explicit, pure,
// testable function instead of the same four checks living inline in
// conversation.ts::runAction() (which is where they lived, correctly, until
// now — this is a consolidation, not a new decision).
//
// Deliberately PURE: no DB calls, no side effects. The caller resolves any
// async facts first (e.g. hasVerifiedSession(contact.id)) and passes plain
// booleans/arrays in — that's what makes this trivially unit-testable and
// keeps this file free of any "server-only" dependency.
// ─────────────────────────────────────────────────────────────────────────────

export type CapabilityGateAction = {
  requiredPermission: string | null;
  resourceGrantKey: string | null;
  resourceParam: string | null;
  requiresStepUp: boolean;
  requiresConfirm: boolean;
  // Consulted (classified) but NOT YET enforced — see needsApproval below.
  approvalRequired: boolean;
};

export type CapabilityGateInput = {
  action: CapabilityGateAction;
  permissions: string[];
  /** The resolved id of the target resource, if this action has one. */
  resolvedResourceId?: string;
  /** The ids this contact's grants[resourceGrantKey] actually contains. */
  grantedResourceIds?: string[];
  hasVerifiedSession: boolean;
  alreadyConfirmed: boolean;
};

export type CapabilityGateDecision =
  | { allowed: false; reason: "permission" | "resource" }
  // Only these three steps are actually ENFORCED by runAction() today —
  // step_up/confirm are the same checks that always existed, just
  // consolidated here rather than inlined.
  | { allowed: true; step: "step_up" | "confirm" | "execute"; needsApproval: boolean };

/** The single source of truth for "what should happen next for this action,
 *  for this actor, in this state" — replaces the four-part inline if-chain
 *  that used to live directly in runAction(). */
export function evaluateCapabilityGate(input: CapabilityGateInput): CapabilityGateDecision {
  const { action } = input;

  if (!hasPermission(input.permissions, action.requiredPermission)) {
    return { allowed: false, reason: "permission" };
  }

  if (action.resourceGrantKey && action.resourceParam) {
    const ok = (input.grantedResourceIds ?? []).includes(input.resolvedResourceId ?? "");
    if (!ok) return { allowed: false, reason: "resource" };
  }

  const needsApproval = action.approvalRequired;
  // NOTE (honest limitation, not an oversight): needsApproval is real,
  // correct classification — but runAction() does NOT currently block
  // execution on it. Actually enforcing approvalRequired needs a resumable
  // "pending approval → admin approves → execution resumes" pipeline (a
  // PendingApproval-style model, a dashboard approve/reject action, routing
  // through the Notification Engine to alert the approver) that doesn't
  // exist yet. Gating execution behind approval WITHOUT that resume
  // mechanism would strand any action an admin marks approvalRequired in a
  // dead end with no way to ever complete — worse than not enforcing it at
  // all. No ConnectorAction has approvalRequired:true today (schema
  // default is false, no admin UI sets it yet), so this is genuinely inert
  // in production right now, not a live gap. Build the resume pipeline as
  // its own slice before ever setting approvalRequired:true on a real action.

  if (action.requiresStepUp && !input.hasVerifiedSession) {
    return { allowed: true, step: "step_up", needsApproval };
  }
  if (action.requiresConfirm && !input.alreadyConfirmed) {
    return { allowed: true, step: "confirm", needsApproval };
  }
  return { allowed: true, step: "execute", needsApproval };
}
