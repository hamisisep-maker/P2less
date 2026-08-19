import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { getSettingNumber } from "./platform-settings";
import { isOverdue } from "./job-runner";

// ─────────────────────────────────────────────────────────────────────────────
// Proactive detection — nothing here waits for an admin to notice a red
// dashboard. Each "open or bump" function is idempotent: a problem that's
// still happening bumps the SAME Incident row's occurrenceCount/lastDetectedAt
// rather than spawning a new one every sweep tick. The full periodic sweep
// (AI error rate, M-Pesa callback silence, reconciliation backlog) is added
// in Phase 3 (runIncidentSweep) — this file starts with the job-failure path
// because job-runner.ts needs a real target to call on every failure, not a
// stub that would silently do nothing until Phase 3 lands.
// ─────────────────────────────────────────────────────────────────────────────

async function openOrBumpIncident(input: {
  severity: "critical" | "warning" | "info";
  source: string;
  title: string;
  relatedJobKey?: string;
  relatedIntegrationKey?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const existing = await db.incident.findFirst({
    where: { source: input.source, status: { not: "resolved" } },
    orderBy: { firstDetectedAt: "desc" },
  });

  if (existing) {
    await db.incident.update({
      where: { id: existing.id },
      data: {
        lastDetectedAt: new Date(),
        occurrenceCount: { increment: 1 },
        title: input.title, // keep the reason current, e.g. updated failure counts
        detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await db.incidentEvent.create({
      data: { incidentId: existing.id, type: "reoccurred", detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined },
    });
    return;
  }

  const incident = await db.incident.create({
    data: {
      severity: input.severity,
      source: input.source,
      title: input.title,
      relatedJobKey: input.relatedJobKey,
      relatedIntegrationKey: input.relatedIntegrationKey,
      detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  await db.incidentEvent.create({
    data: { incidentId: incident.id, type: "detected", detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}

/** Called by job-runner.ts after every failed JobRun. Opens/bumps an
 *  incident once a job has failed `incident_job_consecutive_failures` times
 *  in a row — not on every single failure, since a job that fails once and
 *  recovers on retry is normal, not an incident. */
export async function maybeOpenJobFailureIncident(jobKey: string, consecutiveFailures: number, error: string): Promise<void> {
  const threshold = await getSettingNumber("incident_job_consecutive_failures");
  if (consecutiveFailures < threshold) return;
  await openOrBumpIncident({
    severity: "warning",
    source: `background_job:${jobKey}`,
    title: `Background job "${jobKey}" has failed ${consecutiveFailures} consecutive times`,
    relatedJobKey: jobKey,
    detail: { consecutiveFailures, lastError: error },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The periodic sweep — this is what makes detection PROACTIVE rather than
// "wait for an admin to notice a red dashboard." Each check is independent
// and never resolves an incident automatically; per the spec, resolution is
// always a human action (Detected -> Acknowledged -> Investigating ->
// Resolved) recorded with a real cause/resolution — a condition clearing on
// its own just means occurrenceCount stops climbing, not that the record
// disappears.
// ─────────────────────────────────────────────────────────────────────────────

async function checkOverdueJobs(): Promise<void> {
  const jobs = await db.jobDefinition.findMany({ where: { enabled: true } });
  for (const job of jobs) {
    if (!isOverdue(job)) continue;
    const minutesLate = job.lastRunAt ? Math.round((Date.now() - job.lastRunAt.getTime()) / 60_000) : null;
    await openOrBumpIncident({
      severity: "warning",
      source: `background_job:${job.key}`,
      title: `Background job "${job.name}" hasn't run when expected` + (minutesLate != null ? ` — last ran ${minutesLate}m ago` : " — never ran"),
      relatedJobKey: job.key,
      detail: { expectedIntervalMs: job.intervalMs, lastRunAt: job.lastRunAt, minutesLate },
    });
  }
}

async function checkAiErrorRates(): Promise<void> {
  const thresholdPct = await getSettingNumber("incident_ai_error_rate_pct");
  const windowMinutes = await getSettingNumber("incident_ai_window_minutes");
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const events = await db.aiCallEvent.groupBy({
    by: ["provider"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  for (const { provider } of events) {
    const [total, failures, lastSuccess] = await Promise.all([
      db.aiCallEvent.count({ where: { provider, createdAt: { gte: since } } }),
      db.aiCallEvent.count({ where: { provider, createdAt: { gte: since }, ok: false } }),
      db.aiCallEvent.findFirst({ where: { provider, ok: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    if (total < 3) continue; // not enough samples to mean anything
    const errorRatePct = (failures / total) * 100;
    if (errorRatePct < thresholdPct) continue;
    const lastSuccessMinutesAgo = lastSuccess ? Math.round((Date.now() - lastSuccess.createdAt.getTime()) / 60_000) : null;
    await openOrBumpIncident({
      severity: "critical",
      source: `ai_${provider}`,
      title: `${provider} — ${failures} failure(s) in the last ${windowMinutes} minutes, error rate ${errorRatePct.toFixed(1)}%, last successful request ${lastSuccessMinutesAgo != null ? `${lastSuccessMinutesAgo}m ago` : "never"}`,
      relatedIntegrationKey: `ai_${provider}`,
      detail: { total, failures, errorRatePct: Math.round(errorRatePct * 10) / 10, windowMinutes, lastSuccessMinutesAgo },
    });
  }
}

async function checkMpesaCallbackSilence(): Promise<void> {
  const silenceMinutes = await getSettingNumber("incident_mpesa_callback_silence_minutes");
  const cutoff = new Date(Date.now() - silenceMinutes * 60_000);
  const channels = await db.paymentChannel.findMany({ where: { key: { startsWith: "mpesa_" } }, include: { integration: true } });
  for (const channel of channels) {
    if (!channel.integration.enabled) continue;
    if (!channel.lastCallbackAt || channel.lastCallbackAt >= cutoff) continue; // has never received one, or recent — not silence
    const stillWaiting = await db.payment.count({ where: { channelKey: channel.key, status: "pending", createdAt: { lt: cutoff } } });
    if (stillWaiting === 0) continue; // nothing is actually waiting on a callback right now
    const silentMinutes = Math.round((Date.now() - channel.lastCallbackAt.getTime()) / 60_000);
    await openOrBumpIncident({
      severity: "critical",
      source: channel.key,
      title: `${channel.key} — no callback received for ${silentMinutes}m, ${stillWaiting} payment(s) waiting`,
      relatedIntegrationKey: channel.key,
      detail: { silentMinutes, stillWaiting },
    });
  }
}

async function checkReconciliationBacklog(): Promise<void> {
  const threshold = await getSettingNumber("incident_reconciliation_unresolved_threshold");
  const [unmatched, unknown] = await Promise.all([
    db.unmatchedTransaction.count({ where: { status: "unmatched" } }),
    db.payment.count({ where: { status: "unknown" } }),
  ]);
  const total = unmatched + unknown;
  if (total < threshold) return;
  await openOrBumpIncident({
    severity: "warning",
    source: "reconciliation",
    title: `Billing reconciliation has ${total} unresolved item(s) (${unmatched} unmatched transaction(s), ${unknown} payment(s) in unknown state)`,
    detail: { unmatched, unknown, threshold },
  });
}

export async function runIncidentSweep(): Promise<{ checksRun: number }> {
  await Promise.all([checkOverdueJobs(), checkAiErrorRates(), checkMpesaCallbackSilence(), checkReconciliationBacklog()]);
  return { checksRun: 4 };
}

export { openOrBumpIncident };
