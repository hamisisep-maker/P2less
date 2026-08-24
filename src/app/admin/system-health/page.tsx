import Link from "next/link";
import { requireAdminPermission, hasAdminPermission } from "@/lib/admin-authz";
import { getSystemHealthOverview, getSystemMetrics, type MetricsRange } from "@/lib/system-health";
import { getSetting } from "@/lib/platform-settings";
import { Card, PageHeader, Badge, timeAgo } from "@/components/ui";
import { StatusBadge } from "./status-badge";
import { MetricsSection } from "./metrics-section";
import { MaintenanceCard } from "./maintenance-card";
import { RegistrationCard } from "./registration-card";
import { QualityFeedbackCard } from "./quality-feedback-card";

const VALID_RANGES: MetricsRange[] = ["1h", "24h", "7d", "30d"];

export default async function AdminSystemHealthPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const admin = await requireAdminPermission("system_health.view");
  const { range: rawRange } = await searchParams;
  const range: MetricsRange = VALID_RANGES.includes(rawRange as MetricsRange) ? (rawRange as MetricsRange) : "24h";

  const [h, metrics, maintenanceEnabled, maintenanceReason, maintenanceStartedAt, registrationEnabled, qualityFeedbackEnabled] = await Promise.all([
    getSystemHealthOverview(),
    getSystemMetrics(range),
    getSetting("maintenance_enabled"),
    getSetting("maintenance_reason"),
    getSetting("maintenance_started_at"),
    getSetting("public_registration_enabled"),
    getSetting("quality_feedback_invitation_enabled"),
  ]);

  const categories: { label: string; summary: typeof h.platform }[] = [
    { label: "Platform", summary: h.platform },
    { label: "Database", summary: h.database },
    { label: "M-Pesa", summary: h.mpesa },
    { label: "WhatsApp", summary: h.whatsapp },
    { label: "AI", summary: h.ai },
    { label: "Background Jobs", summary: h.backgroundJobs },
  ];

  return (
    <div>
      <PageHeader
        title="System Health"
        subtitle="Real status, computed from real signals — every non-green badge below shows the actual reason, not just a color."
        action={<Link href="/admin/incidents" className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-surface-2">View incidents</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {categories.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-faint">{c.label}</div>
            <div className="mt-2"><StatusBadge status={c.summary.status} /></div>
          </Card>
        ))}
      </div>

      {categories.some((c) => c.summary.reasons.length > 0) && (
        <Card className="mt-4 border-amber/30 bg-amber-soft/30 p-4">
          <h2 className="mb-2 text-sm font-semibold">Actual reasons</h2>
          <div className="space-y-1.5 text-sm">
            {categories.filter((c) => c.summary.reasons.length > 0).flatMap((c) =>
              c.summary.reasons.map((r, i) => (
                <div key={`${c.label}-${i}`} className="flex items-start gap-2">
                  <Badge tone={c.summary.status === "unhealthy" ? "rose" : "amber"}>{c.label}</Badge>
                  <span>{r}</span>
                </div>
              )),
            )}
          </div>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">M-Pesa channels</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {h.mpesaChannels.map((c) => (
            <div key={c.key} className="flex items-center justify-between rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
              <div>
                <span className="font-medium">{c.name}</span>
                <div className="text-xs text-muted">{c.detail}</div>
              </div>
              <Badge tone={!c.enabled ? "neutral" : c.ok === true ? "green" : c.ok === false ? "rose" : "amber"} dot>
                {!c.enabled ? "disabled" : c.ok === true ? "operational" : c.ok === false ? "unhealthy" : "not configured"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">AI providers (last window)</h2>
        {h.aiProviders.length === 0 && <p className="text-sm text-muted">No AI calls recorded yet in the current window.</p>}
        <div className="space-y-2">
          {h.aiProviders.map((p) => (
            <div key={p.provider} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
              <div>
                <span className="font-medium">{p.provider}</span>
                <div className="text-xs text-muted">
                  {p.total} call(s) · {p.failures} failure(s) · error rate {p.errorRatePct}% · last success {p.lastSuccessAt ? timeAgo(p.lastSuccessAt) : "never"} · last failure {p.lastFailureAt ? timeAgo(p.lastFailureAt) : "never"}
                </div>
              </div>
              <StatusBadge status={p.status} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Background jobs</h2>
        <p className="mb-3 text-xs text-muted">Every scheduled job's real execution history — this is what answers &quot;why wasn&apos;t this tenant suspended?&quot;</p>
        <div className="space-y-2">
          {h.jobs.map((j) => (
            <div key={j.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
              <div>
                <span className="font-medium">{j.name}</span>
                <Badge tone="neutral" >{j.category}</Badge>
                <div className="mt-1 text-xs text-muted">
                  Last run {j.lastRunAt ? timeAgo(j.lastRunAt) : "never"} · last success {j.lastSuccessAt ? timeAgo(j.lastSuccessAt) : "never"} · last failure {j.lastFailureAt ? timeAgo(j.lastFailureAt) : "never"} · {j.consecutiveFailures} consecutive failure(s) · next run {j.nextRunAt ? timeAgo(j.nextRunAt) : "unscheduled"}
                </div>
              </div>
              <Badge tone={j.overdue ? "rose" : j.status === "failed" ? "amber" : j.status === "never_run" ? "neutral" : "green"} dot>
                {j.overdue ? "overdue" : j.status === "failed" ? "failing" : j.status === "never_run" ? "never run" : "on schedule"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      <MetricsSection metrics={metrics} range={range} />

      {hasAdminPermission(admin, "maintenance.manage") && (
        <div className="mt-4 space-y-4">
          <RegistrationCard enabled={registrationEnabled === "1"} />
          <QualityFeedbackCard enabled={qualityFeedbackEnabled === "1"} />
          <MaintenanceCard enabled={maintenanceEnabled === "1"} reason={maintenanceReason} startedAt={maintenanceStartedAt} />
        </div>
      )}
    </div>
  );
}
