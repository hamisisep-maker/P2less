// ─────────────────────────────────────────────────────────────────────────────
// Intent engine — deterministic natural-language → action matcher.
//
// Given the tenant's configured actions (each with sample phrases/keywords), it
// scores the user's message and extracts entities (student names, dates). It
// runs with NO API key. ai.ts can layer Claude on top for fuzzier phrasing, but
// Claude is constrained to choosing from THIS same set of actions — it can never
// invent an action or query anything directly.
// ─────────────────────────────────────────────────────────────────────────────

export type IntentAction = {
  id: string;
  key: string;
  name: string;
  samplePhrases: string[];
  description?: string | null;
};

export type IntentMatch = {
  actionId: string | null;
  actionKey: string | null;
  score: number; // 0..1 confidence
  entities: Record<string, string>;
  candidates: { actionId: string; actionKey: string; score: number }[];
};

const STOP = new Set([
  "the", "a", "an", "my", "me", "i", "is", "are", "what", "whats", "show", "get",
  "please", "can", "you", "of", "for", "to", "do", "does", "how", "much", "and",
  "his", "her", "their", "on", "in", "at", "this", "that", "s",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

/** Levenshtein edit distance (bounded use — tokens are short). */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
}

/** Fuzzy token equality — tolerant of typos and cut-off/partial words. */
function fuzzyEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  // Cut-off / partial words: "payslp" vs "payslip", "leav" vs "leave".
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const tol = Math.max(a.length, b.length) >= 7 ? 2 : 1;
  return levenshtein(a, b) <= tol;
}

const GREETINGS = [
  "hi", "hello", "hey", "yo", "hiya", "howdy", "hola", "sup", "wassup", "whatsup",
  "greetings", "morning", "afternoon", "evening", "helo", "heya", "ola", "hy",
  "gday", "good", "start", "hei", "niaje", "mambo", "sasa", "habari",
];

/** True if a short message is a greeting (tolerant of typos: "helloo", "hii").
 *  Careful with short tokens so common words like "my"/"is" never count. */
export function isGreeting(text: string): boolean {
  const toks = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (toks.length === 0 || toks.length > 3) return false;
  return toks.some((t) =>
    GREETINGS.some((g) => {
      if (t === g) return true; // exact (covers "yo", "hy", "sasa"…)
      if (t.length >= 3 && (t.startsWith(g) || g.startsWith(t))) return true; // "hii", "helloo"
      if (t.length >= 4 && levenshtein(t, g) <= 1) return true; // typos on real words: "helo"
      return false;
    }),
  );
}

/** Extract a likely person name: a run of Capitalized words, excluding common
 *  sentence-leading words. Captures multi-word names like "Brian Kamau". */
export function extractName(text: string): string | undefined {
  const common = new Set([
    "I", "Show", "What", "When", "Where", "Which", "Why", "How", "Has", "Have", "Is", "Are", "Was", "Will", "Should",
    "Send", "Get", "My", "Please", "Hi", "Hello", "Hey", "Whats", "Who", "The", "And", "Book", "Schedule", "Make",
    "Cancel", "Pay", "Register", "Do", "Does", "Can", "Could", "Would", "Tell", "Give", "Track", "Find", "Check",
    "Update", "Submit", "Need", "Want", "Order", "Reset",
  ]);
  // Strip a leading "'s" possessive so "John's" → "John".
  const runs = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) ?? [];
  for (const run of runs) {
    const words = run.split(/\s+/).filter((w) => !common.has(w));
    if (words.length) return words.join(" ");
  }
  return undefined;
}

/** Extract a time-of-day like "10am", "10:30", "2 pm", "at 3". */
export function extractTime(text: string): string | undefined {
  const t = text.toLowerCase();
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/) || t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return undefined;
  const hour = m[1];
  const mins = m[2] ?? "00";
  const ampm = /am|pm/.test(t) ? (t.includes("pm") ? " PM" : " AM") : "";
  return `${hour}:${mins}${ampm}`.trim();
}

export function extractDate(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return "today";
  if (/\btomorrow\b/.test(t)) return "tomorrow";
  if (/\byesterday\b/.test(t)) return "yesterday";
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  for (const d of days) if (t.includes(d)) return d;
  return undefined;
}

/**
 * Score each action against the message using token overlap with its sample
 * phrases + name. Returns the best match and ranked candidates.
 */
export function matchIntent(text: string, actions: IntentAction[]): IntentMatch {
  const msgTokens = [...new Set(tokenize(text))];
  const scored = actions.map((a) => {
    const phraseTokens = new Set<string>();
    for (const p of a.samplePhrases ?? []) tokenize(p).forEach((t) => phraseTokens.add(t));
    tokenize(a.name).forEach((t) => phraseTokens.add(t));
    if (phraseTokens.size === 0) return { actionId: a.id, actionKey: a.key, score: 0 };
    const phraseArr = [...phraseTokens];
    // Overlap: an EXACT token match is worth more than a fuzzy one, so precise
    // phrasing ("reschedule") beats a near-miss ("schedule") while typos still
    // resolve ("payslp" → payslip, "leav" → leave).
    let overlap = 0;
    for (const t of msgTokens) {
      if (phraseTokens.has(t)) overlap += 1;
      else if (phraseArr.some((p) => fuzzyEq(t, p))) overlap += 0.6;
    }
    // Score = overlap normalized by the message length (favor specific matches).
    const denom = Math.max(1, msgTokens.length);
    const score = overlap / denom;
    return { actionId: a.id, actionKey: a.key, score };
  });
  scored.sort((x, y) => y.score - x.score);
  const best = scored[0];
  const entities: Record<string, string> = {};
  const name = extractName(text);
  if (name) entities.name = name;
  const date = extractDate(text);
  if (date) entities.date = date;
  const time = extractTime(text);
  if (time) entities.time = time;

  return {
    actionId: best && best.score > 0 ? best.actionId : null,
    actionKey: best && best.score > 0 ? best.actionKey : null,
    score: best?.score ?? 0,
    entities,
    candidates: scored.filter((s) => s.score > 0).slice(0, 5),
  };
}
