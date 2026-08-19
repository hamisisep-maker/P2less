import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { getSettingNumber } from "./platform-settings";
import { isOverdue } from "./job-runner";
import { mpesaFailureCategoryLabel } from "./mpesa";

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

/** The ONE deliberate exception to "resolution is always a human action" —
 *  used only by checkStkFailureRateAnomaly, where the rate returning to
 *  baseline IS itself the evidence of recovery, per the user's explicit spec
 *  that this specific check must self-clear rather than sit open waiting for
 *  a click. resolvedById/actorId stay null so the UI/audit trail can tell an
 *  automatic resolution apart from a human one if it ever needs to. */
async function autoResolveIfRecovered(source: string, note: string): Promise<void> {
  const existing = await db.incident.findFirst({ where: { source, status: { not: "resolved" } } });
  if (!existing) return;
  await db.incident.update({
    where: { id: existing.id },
    data: { status: "resolved", resolvedAt: new Date(), cause: "Failure rate returned to normal automatically.", resolutionNote: note },
  });
  await db.incidentEvent.create({ data: { incidentId: existing.id, type: "resolved", note, detail: { autoResolved: true } } });
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

const STK_FAILURE_SOURCE = "mpesa_stk_failure_rate";

/** 5th check — a failure-RATE spike, distinct from checkMpesaCallbackSilence
 *  (total silence) above. 6/9 STK pushes failing while callbacks are still
 *  arriving fine for the successful ones would never trip the silence check,
 *  but is operationally significant on its own. Configurable via
 *  platform-settings, never hard-coded: minimum sample size guards against
 *  over-sensitivity (2 attempts, both failing, isn't evidence of anything),
 *  warning/critical are two real severities, and the window is rolling. */
async function checkStkFailureRateAnomaly(): Promise<void> {
  const [minSample, warningPct, criticalPct, windowMinutes] = await Promise.all([
    getSettingNumber("incident_stk_failure_min_sample_size"),
    getSettingNumber("incident_stk_failure_warning_pct"),
    getSettingNumber("incident_stk_failure_critical_pct"),
    getSettingNumber("incident_stk_failure_window_minutes"),
  ]);
  const windowStart = new Date(Date.now() - windowMinutes * 60_000);

  const windowPayments = await db.payment.findMany({
    where: { channelKey: "mpesa_stk", createdAt: { gte: windowStart } },
    select: { reference: true, status: true, failureCategory: true },
  });
  const attempts = windowPayments.length;
  if (attempts < minSample) return; // not enough samples to mean anything — never open OR resolve on thin data

  const failedPayments = windowPayments.filter((p) => p.status === "failed");
  const failed = failedPayments.length;
  const failureRatePct = Math.round((failed / attempts) * 1000) / 10;

  const categoryCounts: Record<string, number> = {};
  for (const p of failedPayments) {
    const cat = p.failureCategory ?? "unknown";
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
  }

  // Baseline = the failure rate over the preceding 24h, EXCLUDING this window
  // — context for a human ("is this normal for us?"), never used to gate
  // whether the incident fires; insufficient prior data reads as "no baseline
  // yet" rather than a fabricated 0%.
  const baselineStart = new Date(windowStart.getTime() - 24 * 60 * 60_000);
  const [baselineAttempts, baselineFailed] = await Promise.all([
    db.payment.count({ where: { channelKey: "mpesa_stk", createdAt: { gte: baselineStart, lt: windowStart } } }),
    db.payment.count({ where: { channelKey: "mpesa_stk", status: "failed", createdAt: { gte: baselineStart, lt: windowStart } } }),
  ]);
  const baselinePct = baselineAttempts >= minSample ? Math.round((baselineFailed / baselineAttempts) * 1000) / 10 : null;

  if (failureRatePct < warningPct) {
    await autoResolveIfRecovered(
      STK_FAILURE_SOURCE,
      `Failure rate returned to ${failureRatePct}% (${failed}/${attempts}), below the ${warningPct}% warning threshold — based on ${attempts} attempt(s) in the last ${windowMinutes} minutes.`,
    );
    return;
  }

  const severity = failureRatePct >= criticalPct ? "critical" : "warning";
  const dominant = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
  const dominantNote = dominant ? ` — mostly ${mpesaFailureCategoryLabel(dominant[0])} (${dominant[1]})` : "";

  await openOrBumpIncident({
    severity,
    source: STK_FAILURE_SOURCE,
    title: `M-Pesa STK Push failure-rate spike — ${failureRatePct}% (${failed}/${attempts}) in the last ${windowMinutes}m${dominantNote}`,
    relatedIntegrationKey: "mpesa_stk",
    detail: {
      windowMinutes, attempts, failed, failureRatePct, baselinePct,
      minSampleSize: minSample, warningPct, criticalPct,
      categoryCounts,
      affectedReferences: failedPayments.slice(0, 30).map((p) => p.reference),
    },
  });
}

export async function runIncidentSweep(): Promise<{ checksRun: number }> {
  await Promise.all([checkOverdueJobs(), checkAiErrorRates(), checkMpesaCallbackSilence(), checkReconciliationBacklog(), checkStkFailureRateAnomaly()]);
  return { checksRun: 5 };
}

export { openOrBumpIncident };
