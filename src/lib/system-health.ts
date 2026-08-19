import "server-only";
import { db } from "./db";
import { isConfigured as mpesaConfigured } from "./mpesa";

// ─────────────────────────────────────────────────────────────────────────────
// Real health computation per integration — never "API key exists = healthy".
// Every branch below either (a) actively but SAFELY tests the dependency
// (the database ping — free, no external cost), or (b) derives a real
// verdict from genuine recent activity already logged elsewhere (AiProviderStat,
// Message, Payment) — never a bare presence check standing in for a live
// signal. Where there's genuinely no signal yet (card, email/sms, C2B not
// registered), the verdict is explicitly `null` ("not applicable / no data"),
// never a fabricated green.
//
// ok: true = healthy, false = unhealthy, null = not configured / no data yet
// (deliberately a third state, not squeezed into a boolean).
// ─────────────────────────────────────────────────────────────────────────────

export type HealthVerdict = { ok: boolean | null; detail: string; latencyMs?: number };

export async function checkDatabaseHealth(): Promise<HealthVerdict> {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, detail: "Reachable", latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, detail: `Connection failed: ${e instanceof Error ? e.message : String(e)}`, latencyMs: Date.now() - started };
  }
}

async function checkAiProviderHealth(provider: string): Promise<HealthVerdict> {
  const envKey: Record<string, string> = {
    ai_google: "GEMINI_API_KEY", ai_groq: "GROQ_API_KEY", ai_cerebras: "CEREBRAS_API_KEY",
    ai_openrouter: "OPENROUTER_API_KEY", ai_anthropic: "ANTHROPIC_API_KEY", ai_openai: "OPENAI_API_KEY", ai_xai: "XAI_API_KEY",
  };
  const providerId = provider.replace("ai_", "");
  if (!process.env[envKey[provider]]) return { ok: null, detail: "No API key configured" };

  const today = new Date().toISOString().slice(0, 10);
  const stat = await db.aiProviderStat.findUnique({ where: { provider_date: { provider: providerId, date: today } } });
  if (!stat || stat.calls === 0) return { ok: null, detail: "No calls yet today" };
  if (stat.failures > 0 && stat.successes === 0) return { ok: false, detail: `${stat.failures} failure(s) today, no successes — last error: ${stat.lastError ?? "unknown"}` };
  if (stat.failures > 0) return { ok: true, detail: `${stat.successes} success, ${stat.failures} failure(s) today` };
  return { ok: true, detail: `${stat.successes} successful call(s) today` };
}

async function checkWhatsAppHealth(): Promise<HealthVerdict> {
  if (!process.env.WHATSAPP_ACCESS_TOKEN) return { ok: null, detail: "No access token configured (using local web-chat simulator)" };
  const lastIn = await db.message.findFirst({ where: { direction: "in" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const lastOut = await db.message.findFirst({ where: { direction: "out" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!lastIn && !lastOut) return { ok: null, detail: "No messages sent or received yet" };
  const mostRecent = [lastIn?.createdAt, lastOut?.createdAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0]!;
  const ageHours = (Date.now() - mostRecent.getTime()) / 3_600_000;
  return { ok: true, detail: `Last message activity ${ageHours < 1 ? "under an hour" : Math.round(ageHours) + "h"} ago` };
}

async function checkMpesaStkHealth(): Promise<HealthVerdict> {
  if (!mpesaConfigured()) return { ok: null, detail: "Not configured — using mock mode" };
  const recent = await db.payment.findMany({ where: { method: "mpesa", provider: "daraja" }, orderBy: { createdAt: "desc" }, take: 20 });
  if (recent.length === 0) return { ok: null, detail: "Configured, no STK pushes sent yet" };
  const paid = recent.filter((p) => p.status === "paid").length;
  const failed = recent.filter((p) => p.status === "failed").length;
  if (failed > 0 && paid === 0) return { ok: false, detail: `${failed}/${recent.length} recent STK pushes failed` };
  return { ok: true, detail: `${paid}/${recent.length} of the last ${recent.length} STK pushes confirmed paid` };
}

export async function computeIntegrationHealth(key: string): Promise<HealthVerdict> {
  if (key === "database") return checkDatabaseHealth();
  if (key.startsWith("ai_")) return checkAiProviderHealth(key);
  if (key === "whatsapp_cloud_api") return checkWhatsAppHealth();
  if (key === "mpesa_stk") return checkMpesaStkHealth();
  if (key === "mpesa_paybill" || key === "mpesa_till") return { ok: null, detail: "Not receiving live traffic yet (Daraja C2B URL not registered with Safaricom)" };
  if (key === "bank_transfer") return { ok: null, detail: "Manual statement reconciliation only — no live feed" };
  if (key === "card") return { ok: null, detail: "Not implemented" };
  if (key === "email_provider" || key === "sms_provider") return { ok: null, detail: "Not configured" };
  if (key === "storage") return { ok: null, detail: "Not actively checked" };
  return { ok: null, detail: "No health check implemented for this integration yet" };
}

/** Background job: sweeps every Integration row and caches its verdict for
 *  the list view. Detail pages always recompute live via computeIntegrationHealth
 *  directly — this cache exists purely so /admin/integrations doesn't run
 *  ~17 checks synchronously on every page load. */
export async function runIntegrationHealthSweep(): Promise<{ checked: number; unhealthy: number }> {
  const integrations = await db.integration.findMany({ select: { key: true } });
  let unhealthy = 0;
  for (const { key } of integrations) {
    const verdict = await computeIntegrationHealth(key);
    if (verdict.ok === false) unhealthy++;
    await db.integration.update({
      where: { key },
      data: { lastCheckedAt: new Date(), lastCheckOk: verdict.ok, lastCheckDetail: verdict.detail },
    }).catch(() => {});
  }
  return { checked: integrations.length, unhealthy };
}

/** Background job: the live DB ping, run frequently and cheaply on its own
 *  schedule (SELECT 1 is essentially free on SQLite) so a trend exists even
 *  between the slower general integration sweep's ticks. */
export async function runDbHealthSweep(): Promise<{ ok: boolean; latencyMs?: number }> {
  const verdict = await checkDatabaseHealth();
  await db.integration.update({
    where: { key: "database" },
    data: { lastCheckedAt: new Date(), lastCheckOk: verdict.ok, lastCheckDetail: verdict.detail },
  }).catch(() => {});
  return { ok: verdict.ok === true, latencyMs: verdict.latencyMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// The unified /admin/system-health view. This is a READ-THROUGH composition
// over tables that already exist (Integration, PaymentChannel, AiCallEvent,
// JobDefinition, Incident) — not a new source of truth. "The actual reason"
// behind a non-healthy category is literally the matching OPEN Incident's own
// title (already a real-numbers sentence from incident-detection.ts), so this
// never invents a second explanation of the same fact.
// ─────────────────────────────────────────────────────────────────────────────

export type CategoryStatus = "healthy" | "degraded" | "unhealthy" | "unknown";
export type CategorySummary = { status: CategoryStatus; reasons: string[] };

export type AiProviderHealth = {
  provider: string; total: number; failures: number; errorRatePct: number;
  lastSuccessAt: Date | null; lastFailureAt: Date | null; status: CategoryStatus;
};

export type JobHealth = {
  key: string; name: string; category: string; status: "success" | "failed" | "running" | "never_run";
  lastRunAt: Date | null; lastSuccessAt: Date | null; lastFailureAt: Date | null;
  consecutiveFailures: number; nextRunAt: Date | null; intervalMs: number; overdue: boolean;
};

export type SystemHealthOverview = {
  platform: CategorySummary;
  database: CategorySummary;
  mpesa: CategorySummary;
  whatsapp: CategorySummary;
  ai: CategorySummary;
  backgroundJobs: CategorySummary;
  aiProviders: AiProviderHealth[];
  jobs: JobHealth[];
  mpesaChannels: { key: string; name: string; ok: boolean | null; enabled: boolean; detail: string }[];
  openIncidents: { id: string; severity: string; source: string; title: string; status: string; occurrenceCount: number; lastDetectedAt: Date }[];
};

function reasonsForSource(incidents: SystemHealthOverview["openIncidents"], predicate: (source: string) => boolean): string[] {
  return incidents.filter((i) => predicate(i.source)).map((i) => i.title);
}

export async function getSystemHealthOverview(): Promise<SystemHealthOverview> {
  const { nextRunAt, isOverdue } = await import("./job-runner");
  const { getSettingNumber } = await import("./platform-settings");

  const [dbVerdict, integrations, jobDefs, openIncidentsRaw, aiWindowMinutes, aiThresholdPct] = await Promise.all([
    checkDatabaseHealth(),
    db.integration.findMany({ include: { paymentChannel: true } }),
    db.jobDefinition.findMany(),
    db.incident.findMany({ where: { status: { not: "resolved" } }, orderBy: { lastDetectedAt: "desc" } }),
    getSettingNumber("incident_ai_window_minutes"),
    getSettingNumber("incident_ai_error_rate_pct"),
  ]);

  const openIncidents = openIncidentsRaw.map((i) => ({ id: i.id, severity: i.severity, source: i.source, title: i.title, status: i.status, occurrenceCount: i.occurrenceCount, lastDetectedAt: i.lastDetectedAt }));
  const hasCritical = (pred: (s: string) => boolean) => openIncidents.some((i) => pred(i.source) && i.severity === "critical");
  const hasAny = (pred: (s: string) => boolean) => openIncidents.some((i) => pred(i.source));

  // ── AI provider error rates over the real window ────────────────────────
  const since = new Date(Date.now() - aiWindowMinutes * 60_000);
  const providerRows = await db.aiCallEvent.groupBy({ by: ["provider"], where: { createdAt: { gte: since } }, _count: { _all: true } });
  const aiProviders: AiProviderHealth[] = [];
  for (const { provider } of providerRows) {
    const [total, failures, lastSuccess, lastFailure] = await Promise.all([
      db.aiCallEvent.count({ where: { provider, createdAt: { gte: since } } }),
      db.aiCallEvent.count({ where: { provider, createdAt: { gte: since }, ok: false } }),
      db.aiCallEvent.findFirst({ where: { provider, ok: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.aiCallEvent.findFirst({ where: { provider, ok: false }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    const errorRatePct = total > 0 ? (failures / total) * 100 : 0;
    const status: CategoryStatus = total < 3 ? "unknown" : errorRatePct >= aiThresholdPct ? "unhealthy" : failures > 0 ? "degraded" : "healthy";
    aiProviders.push({ provider, total, failures, errorRatePct: Math.round(errorRatePct * 10) / 10, lastSuccessAt: lastSuccess?.createdAt ?? null, lastFailureAt: lastFailure?.createdAt ?? null, status });
  }
  const aiStatus: CategoryStatus = hasCritical((s) => s.startsWith("ai_")) ? "unhealthy"
    : aiProviders.some((p) => p.status === "degraded") ? "degraded"
    : aiProviders.length === 0 ? "unknown" : "healthy";

  // ── Background jobs ──────────────────────────────────────────────────────
  const jobs: JobHealth[] = jobDefs.map((j) => ({
    key: j.key, name: j.name, category: j.category,
    status: !j.lastRunAt ? "never_run" : j.consecutiveFailures > 0 ? "failed" : "success",
    lastRunAt: j.lastRunAt, lastSuccessAt: j.lastSuccessAt, lastFailureAt: j.lastFailureAt,
    consecutiveFailures: j.consecutiveFailures, nextRunAt: nextRunAt(j), intervalMs: j.intervalMs,
    overdue: isOverdue(j),
  }));
  const jobsStatus: CategoryStatus = hasAny((s) => s.startsWith("background_job:")) ? "degraded"
    : jobs.some((j) => j.consecutiveFailures >= 3 || j.overdue) ? "degraded"
    : jobs.length === 0 ? "unknown" : "healthy";

  // ── M-Pesa channels ──────────────────────────────────────────────────────
  const mpesaIntegrations = integrations.filter((i) => i.key.startsWith("mpesa_"));
  const mpesaChannels = mpesaIntegrations.map((i) => ({ key: i.key, name: i.name, ok: i.lastCheckOk, enabled: i.enabled, detail: i.lastCheckDetail ?? "Not checked yet" }));
  const stk = mpesaIntegrations.find((i) => i.key === "mpesa_stk");
  const mpesaStatus: CategoryStatus = hasCritical((s) => s.startsWith("mpesa_")) ? "unhealthy"
    : stk?.lastCheckOk === false ? "unhealthy"
    : hasAny((s) => s.startsWith("mpesa_")) ? "degraded"
    : stk?.lastCheckOk === true ? "healthy" : "unknown";

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  const whatsappIntegration = integrations.find((i) => i.key === "whatsapp_cloud_api");
  const whatsappStatus: CategoryStatus = hasCritical((s) => s === "whatsapp") ? "unhealthy"
    : whatsappIntegration?.lastCheckOk === false ? "unhealthy"
    : hasAny((s) => s === "whatsapp") ? "degraded"
    : whatsappIntegration?.lastCheckOk === true ? "healthy" : "unknown";

  // ── Database ─────────────────────────────────────────────────────────────
  const databaseStatus: CategoryStatus = dbVerdict.ok === true ? "healthy" : dbVerdict.ok === false ? "unhealthy" : "unknown";

  // ── Platform composite ───────────────────────────────────────────────────
  const statuses = [databaseStatus, mpesaStatus, whatsappStatus, aiStatus, jobsStatus];
  const platformStatus: CategoryStatus = databaseStatus === "unhealthy" || statuses.includes("unhealthy") ? "unhealthy"
    : statuses.includes("degraded") ? "degraded"
    : statuses.every((s) => s === "unknown") ? "unknown" : "healthy";

  const summary = (status: CategoryStatus, reasons: string[]): CategorySummary => ({ status, reasons });

  return {
    platform: summary(platformStatus, openIncidents.filter((i) => i.severity === "critical").map((i) => i.title)),
    database: summary(databaseStatus, databaseStatus === "unhealthy" ? [dbVerdict.detail] : []),
    mpesa: summary(mpesaStatus, reasonsForSource(openIncidents, (s) => s.startsWith("mpesa_"))),
    whatsapp: summary(whatsappStatus, reasonsForSource(openIncidents, (s) => s === "whatsapp")),
    ai: summary(aiStatus, reasonsForSource(openIncidents, (s) => s.startsWith("ai_"))),
    backgroundJobs: summary(jobsStatus, reasonsForSource(openIncidents, (s) => s.startsWith("background_job:"))),
    aiProviders, jobs, mpesaChannels, openIncidents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// System metrics with real time ranges — every number here is a straight
// aggregate of a table already written elsewhere in this priority (AiCallEvent,
// Message, Payment, JobRun, UsageEvent) for the requested window. No new
// counter table; this is purely a read-side view.
// ─────────────────────────────────────────────────────────────────────────────

export type MetricsRange = "1h" | "24h" | "7d" | "30d";
export const METRICS_RANGE_MS: Record<MetricsRange, number> = {
  "1h": 3_600_000, "24h": 24 * 3_600_000, "7d": 7 * 24 * 3_600_000, "30d": 30 * 24 * 3_600_000,
};

export type SystemMetrics = {
  rangeMs: number;
  aiCallsTotal: number;
  aiCallsPerMinute: number;
  aiAvgLatencyMs: number;
  aiErrorRatePct: number;
  whatsappMessagesIn: number;
  whatsappMessagesOut: number;
  paymentEventsTotal: number;
  paymentEventsPaid: number;
  activeTenants: number;
  backgroundJobRuns: number;
  backgroundJobFailures: number;
  dbAvgLatencyMs: number | null;
};

export async function getSystemMetrics(range: MetricsRange): Promise<SystemMetrics> {
  const rangeMs = METRICS_RANGE_MS[range];
  const since = new Date(Date.now() - rangeMs);

  const [aiEvents, msgIn, msgOut, payments, paymentsPaid, activeTenants, jobRuns, jobFailures, dbRuns] = await Promise.all([
    db.aiCallEvent.findMany({ where: { createdAt: { gte: since } }, select: { ok: true, latencyMs: true } }),
    db.message.count({ where: { direction: "in", createdAt: { gte: since } } }),
    db.message.count({ where: { direction: "out", createdAt: { gte: since } } }),
    db.payment.count({ where: { createdAt: { gte: since } } }),
    db.payment.count({ where: { createdAt: { gte: since }, status: "paid" } }),
    db.usageEvent.findMany({ where: { createdAt: { gte: since } }, distinct: ["tenantId"], select: { tenantId: true } }),
    db.jobRun.count({ where: { startedAt: { gte: since } } }),
    db.jobRun.count({ where: { startedAt: { gte: since }, status: "failed" } }),
    db.jobRun.findMany({ where: { jobKey: "db_health_sweep", startedAt: { gte: since }, status: "success" }, select: { resultJson: true } }),
  ]);

  const aiCallsTotal = aiEvents.length;
  const aiFailures = aiEvents.filter((e) => !e.ok).length;
  const latencies = aiEvents.map((e) => e.latencyMs).filter((n): n is number => n != null);
  const dbLatencies = dbRuns.map((r) => (r.resultJson as { latencyMs?: number } | null)?.latencyMs).filter((n): n is number => n != null);

  return {
    rangeMs,
    aiCallsTotal,
    aiCallsPerMinute: Math.round((aiCallsTotal / (rangeMs / 60_000)) * 100) / 100,
    aiAvgLatencyMs: latencies.length ? Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length) : 0,
    aiErrorRatePct: aiCallsTotal ? Math.round((aiFailures / aiCallsTotal) * 1000) / 10 : 0,
    whatsappMessagesIn: msgIn,
    whatsappMessagesOut: msgOut,
    paymentEventsTotal: payments,
    paymentEventsPaid: paymentsPaid,
    activeTenants: activeTenants.length,
    backgroundJobRuns: jobRuns,
    backgroundJobFailures: jobFailures,
    dbAvgLatencyMs: dbLatencies.length ? Math.round(dbLatencies.reduce((s, n) => s + n, 0) / dbLatencies.length) : null,
  };
}
