import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// The shared "known failure vs unknown state" rule, applied consistently
// everywhere a provider callback might never arrive: the billing poller's
// reconciliation check, the reconciliation sweep, and incident detection all
// call THIS instead of reimplementing their own age-based guess.
//
// Core principle: an integration failure is not automatically a tenant
// failure. A network error, a timeout, or plain silence before any provider
// response arrived does NOT mean the underlying operation failed — the money
// may have already moved, the message may have already sent. Only an
// EXPLICIT provider-side failure response counts as "definite_failure".
// Everything else is "unknown" until proven otherwise, and "unknown" must
// never by itself feed a tenant-suspending or otherwise punitive path.
// ─────────────────────────────────────────────────────────────────────────────

export type Outcome =
  | { kind: "success" }
  | { kind: "definite_failure"; reason: string }
  | { kind: "unknown"; reason: string; ageMs: number };

export type ErrorKind = "network" | "timeout" | "http_4xx" | "http_5xx" | "explicit_provider_failure";

export function classifyOutcome(input: {
  /** Did the provider actually respond with an explicit success/fail, or is
   *  this call still waiting (no callback, no confirmation)? */
  definitiveResponseReceived: boolean;
  ok?: boolean;
  errorKind?: ErrorKind;
  ageMs: number;
  reconciliationWindowMs: number;
}): Outcome {
  if (input.definitiveResponseReceived) {
    if (input.ok) return { kind: "success" };
    // Only an EXPLICIT provider-side failure is definite. A 4xx/5xx from our
    // own handler, a network error, or a timeout before any provider
    // response arrived is never "definite_failure" — the money/message may
    // still have gone through on the provider's side.
    if (input.errorKind === "explicit_provider_failure") {
      return { kind: "definite_failure", reason: "provider reported failure" };
    }
  }
  if (input.ageMs < input.reconciliationWindowMs) {
    return { kind: "unknown", reason: "awaiting confirmation", ageMs: input.ageMs };
  }
  return { kind: "unknown", reason: input.errorKind ?? "no definitive response received within the reconciliation window", ageMs: input.ageMs };
}

/** Convenience for the common "is this Payment/Subscription old enough to
 *  flag as needing a human to look at it" check. */
export function isStale(startedAt: Date, windowMs: number, now: Date = new Date()): boolean {
  return now.getTime() - startedAt.getTime() >= windowMs;
}
