import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// First-pass distress/crisis detector (2026-08-23 stress-test review, S10 —
// "the most serious design gap... more serious than any security finding,
// because the harm is direct and the foreseeability is total"). NOT a
// clinical classifier — a heuristic, deliberately biased toward recall: a
// false positive here costs an extra warm human handoff; a false negative
// could cost a life. Two tiers so one ambiguous phrase that also shows up in
// ordinary frustrated complaints ("there's no point") doesn't fire alone —
// but the same message combining two such phrases, or any explicit
// self-harm mention on its own, does. English + Swahili, matching the
// languages this platform's own conversations actually use.
// ─────────────────────────────────────────────────────────────────────────────

const STRONG_SIGNALS =
  /\b(kill(?:ing)?\s+myself|end(?:ing)?\s+my\s+life|end\s+it\s+all|want(?:ed)?\s+to\s+die|wanna\s+die|suicid(?:e|al)|hurt(?:ing)?\s+myself|harm(?:ing)?\s+myself|self[- ]harm|not\s+worth\s+living|better\s+off\s+dead|no\s+reason\s+to\s+live|nataka\s+kufa|nitajiua|sitaki\s+kuishi(?:\s+tena)?|sina\s+sababu\s+ya\s+kuishi)\b/i;

const WEAK_SIGNALS: RegExp[] = [
  /\bno\s+point\b/i,
  /\bdon'?t\s+know\s+what\s+to\s+do\s+anymore\b/i,
  /\bcan'?t\s+(?:go\s+on|take\s+it\s+anymore)\b/i,
  /\bi\s+give\s+up\b/i,
  /\bnobody\s+(?:would\s+)?(?:miss|care)\b/i,
  /\bsijui\s+(?:nifanye|la\s+kufanya)\b/i, // "I don't know what to do"
  /\bnimechoka\s+na\s+(?:kila\s*kitu|maisha)\b/i, // "I'm tired of everything / life"
];

/** True if the message carries a plausible distress/crisis signal — either
 *  one explicit self-harm mention, or at least two of the weaker hopelessness
 *  phrases together (reduces false-positives from an ordinary complaint that
 *  happens to include one of them in isolation). */
export function detectDistressSignal(text: string): boolean {
  if (!text) return false;
  if (STRONG_SIGNALS.test(text)) return true;
  const weakHits = WEAK_SIGNALS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  return weakHits >= 2;
}
