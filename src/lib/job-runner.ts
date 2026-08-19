import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { maybeOpenJobFailureIncident } from "./incident-detection";

// ─────────────────────────────────────────────────────────────────────────────
// Every background job — the two pre-existing pollers (billing, dispatch)
// and every new sweep added in this priority — registers itself here and
// executes ONLY through runJobNow(). This is what makes "why wasn't this
// tenant suspended?" answerable: every execution, success or failure, is a
// real JobRun row with a duration and a result/error, not an unobserved
// setInterval callback.
// ─────────────────────────────────────────────────────────────────────────────

export type JobResult = Record<string, unknown> | void;
export type JobFn = () => Promise<JobResult>;
export type JobSpec = { key: string; name: string; category: string; intervalMs: number; run: JobFn };

// Module-scoped state doesn't survive across Next.js's separate bundles for
// the instrumentation hook vs. server actions — each gets its own module
// instance. registerJob() runs once in instrumentation.ts's bundle; runJobNow()
// is called from server actions in a DIFFERENT bundle, so a plain module-level
// Map here would look empty from there ("Unknown job: X" for every manual run).
// globalThis is the one thing actually shared across bundles in one process —
// same fix already applied to startJobPoller's double-start guard below.
const registryHolder = globalThis as unknown as { __p2lessJobRegistry?: Map<string, JobSpec> };
registryHolder.__p2lessJobRegistry ??= new Map<string, JobSpec>();
const REGISTRY = registryHolder.__p2lessJobRegistry;

export function registerJob(spec: JobSpec): void {
  REGISTRY.set(spec.key, spec);
}

export function getJobSpec(key: string): JobSpec | undefined {
  return REGISTRY.get(key);
}

export function listRegisteredJobKeys(): string[] {
  return [...REGISTRY.keys()];
}

/** One real execution, always recorded. Both the setInterval poller and any
 *  admin "run now" button call this — never the raw job function directly. */
export async function runJobNow(key: string, triggeredBy = "scheduler"): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const spec = REGISTRY.get(key);
  if (!spec) throw new Error(`Unknown job: ${key}`);

  await db.jobDefinition.upsert({
    where: { key },
    create: { key, name: spec.name, category: spec.category, intervalMs: spec.intervalMs },
    update: { name: spec.name, category: spec.category, intervalMs: spec.intervalMs },
  });

  const run = await db.jobRun.create({ data: { jobKey: key, status: "running", triggeredBy } });
  const started = Date.now();

  try {
    const result = await spec.run();
    const durationMs = Date.now() - started;
    await db.jobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), durationMs, resultJson: (result ?? undefined) as Prisma.InputJsonValue | undefined },
    });
    await db.jobDefinition.update({ where: { key }, data: { lastRunAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0 } });
    return { ok: true, result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const durationMs = Date.now() - started;
    await db.jobRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), durationMs, error } }).catch(() => {});
    const def = await db.jobDefinition.update({
      where: { key },
      data: { lastRunAt: new Date(), lastFailureAt: new Date(), consecutiveFailures: { increment: 1 } },
    }).catch(() => null);
    if (def) {
      await maybeOpenJobFailureIncident(key, def.consecutiveFailures, error).catch(() => {});
    }
    return { ok: false, error };
  }
}

/** setInterval driver — one shared double-start guard per job key, replacing
 *  each poller's own bespoke globalThis boolean. Safe to call multiple times
 *  (e.g. Next dev-mode hot reload); only ever arms one interval per key. */
export function startJobPoller(key: string): void {
  const spec = REGISTRY.get(key);
  if (!spec) throw new Error(`Unknown job: ${key}`);
  const g = globalThis as unknown as { __p2lessJobPollers?: Set<string> };
  g.__p2lessJobPollers ??= new Set();
  if (g.__p2lessJobPollers.has(key)) return;
  g.__p2lessJobPollers.add(key);
  setInterval(() => {
    runJobNow(key).catch(() => {});
  }, spec.intervalMs);
}

/** "Next scheduled run" is never stored — a setInterval drifts, and a
 *  written-down future timestamp could go stale after a restart. Always
 *  derive it live from the last REAL run. */
export function nextRunAt(job: { lastRunAt: Date | null; intervalMs: number }): Date | null {
  return job.lastRunAt ? new Date(job.lastRunAt.getTime() + job.intervalMs) : null;
}

/** A job is "overdue" — evidence the poller process itself isn't running,
 *  not just that the job threw — when nextRunAt() has passed by more than
 *  one more full interval. Used by the incident sweep (Phase 3). */
export function isOverdue(job: { lastRunAt: Date | null; intervalMs: number }, now: Date = new Date()): boolean {
  const next = nextRunAt(job);
  if (!next) return false; // never run yet — not "overdue", just new
  return now.getTime() - next.getTime() > job.intervalMs;
}
