import "server-only";
import { db } from "./db";

// Deliberately a cheap word-overlap heuristic, not an AI call — this only
// needs to flag "worth a human's attention", never to authoritatively decide
// anything (see the schema comment on SupportTicket.duplicateOfId). An AI
// similarity check would cost real money on every single escalation and add
// a dependency on provider uptime for something that doesn't need it.

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "on", "for",
  "and", "or", "but", "with", "your", "you", "i", "me", "my", "it", "this",
  "that", "please", "hello", "hi", "hey", "thanks", "thank",
]);

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Above this, two escalations are treated as "likely the same underlying
// issue" — tuned conservatively (a false positive just adds a dismissible
// banner; a missed one is the status quo), not derived from real data yet
// since this is the first round this exists.
const SIMILARITY_THRESHOLD = 0.5;
const LOOKBACK_DAYS = 14;

export async function findLikelyDuplicate(
  tenantId: string,
  triggerText: string,
): Promise<{ ticketId: string; similarity: number } | null> {
  const candidateWords = wordSet(triggerText);
  if (candidateWords.size === 0) return null;

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db.supportTicket.findMany({
    where: { tenantId, triggerText: { not: null }, createdAt: { gte: since } },
    select: { id: true, triggerText: true, duplicateOfId: true },
    orderBy: { createdAt: "desc" },
    take: 200, // small-scale by design — see LOOKBACK_DAYS; a real cap, not a magic number
  });

  let best: { ticketId: string; similarity: number } | null = null;
  for (const c of candidates) {
    if (!c.triggerText) continue;
    const sim = jaccardSimilarity(candidateWords, wordSet(c.triggerText));
    if (sim >= SIMILARITY_THRESHOLD && (!best || sim > best.similarity)) {
      // Point at the ROOT of the cluster, never chain — if the match is
      // itself already a duplicate of something, use that root instead.
      best = { ticketId: c.duplicateOfId ?? c.id, similarity: sim };
    }
  }
  return best;
}
