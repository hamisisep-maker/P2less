// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap (Phase 1, 2026-08-19) — see
// docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md. This is the "every fact must
// be tagged Known/Calculated/Configured/Generated/Unknown" shape from the
// vision doc, kept as a plain TS type (not a DB table — provenance travels
// with a REPLY, it isn't persisted state). NOT YET WIRED into ai.ts/
// conversation.ts's buildKnownFacts()/humanizeReply() — Phase 4 does that.
// Exists now purely so the shape is settled before anything depends on it.
// ─────────────────────────────────────────────────────────────────────────────

export type FactSourceKind =
  | "known" // retrieved from a connected system, verified as of retrievedAt
  | "calculated" // deterministically derived from known/configured data (e.g. date math)
  | "configured" // explicitly set by the organization (FAQ, policy, price)
  | "generated" // produced by AI — must never be presented as retrieved fact
  | "unknown"; // could not be verified — the honest "I don't know" case

export type FactSource = {
  kind: FactSourceKind;
  /** Which system this came from, e.g. "connector:school-erp", "mpesa", "platform-setting". Required for known/configured, omitted for generated/unknown. */
  system?: string;
  /** The record id within that system, if applicable (e.g. a student id). */
  recordId?: string;
  /** ISO timestamp of when this was retrieved/computed — lets a reply honestly say "as of a moment ago" vs. stale. */
  retrievedAt?: string;
};
