import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight in-memory sliding-window limiter. Process-local — the same
// honest scale limitation as the WhatsApp webhook's in-memory wamid dedupe
// Set (see transport/webhook route comments): fine for this app's current
// single-instance deployment, would need a shared store (Redis, etc.) under
// real horizontal scaling. Better than the "no rate limiting anywhere" the
// Priority 6 audit found, not a claim of production-grade DDoS protection.
// ─────────────────────────────────────────────────────────────────────────────

const buckets = new Map<string, { count: number; resetAt: number }>();

// Bound memory: buckets are cheap but a process that never restarts would
// otherwise accumulate one entry per distinct key forever.
const MAX_BUCKETS = 20_000;

export function rateLimit(key: string, opts: { max: number; windowMs: number }): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear(); // crude but bounded — a full reset is rare and self-healing
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true };
  }
  if (bucket.count >= opts.max) {
    return { ok: false, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count++;
  return { ok: true };
}
