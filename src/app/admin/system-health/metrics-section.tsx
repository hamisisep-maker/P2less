import Link from "next/link";
import { clsx } from "clsx";
import { Card } from "@/components/ui";
import type { MetricsRange, SystemMetrics } from "@/lib/system-health";

const RANGES: MetricsRange[] = ["1h", "24h", "7d", "30d"];
const RANGE_LABELS: Record<MetricsRange, string> = { "1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line-soft px-3.5 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function MetricsSection({ metrics, range }: { metrics: SystemMetrics; range: MetricsRange }) {
  return (
    <Card className="mt-4 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-semibold">System metrics</h2>
        <div className="flex items-center gap-1 rounded-xl border border-line p-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/admin/system-health?range=${r}`}
              className={clsx(
                "rounded-lg px-3 py-1 text-xs font-medium",
                r === range ? "bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] text-white" : "text-muted hover:bg-surface-2",
              )}
            >
              {RANGE_LABELS[r]}
            </Link>
          ))}
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="AI calls" value={metrics.aiCallsTotal} />
        <Stat label="AI calls/min" value={metrics.aiCallsPerMinute} />
        <Stat label="AI avg latency" value={`${metrics.aiAvgLatencyMs}ms`} />
        <Stat label="AI error rate" value={`${metrics.aiErrorRatePct}%`} />
        <Stat label="DB avg latency" value={metrics.dbAvgLatencyMs != null ? `${metrics.dbAvgLatencyMs}ms` : "n/a"} />
        <Stat label="WhatsApp in" value={metrics.whatsappMessagesIn} />
        <Stat label="WhatsApp out" value={metrics.whatsappMessagesOut} />
        <Stat label="Payment events" value={metrics.paymentEventsTotal} />
        <Stat label="Payments paid" value={metrics.paymentEventsPaid} />
        <Stat label="Active tenants" value={metrics.activeTenants} />
        <Stat label="Job runs" value={metrics.backgroundJobRuns} />
        <Stat label="Job failures" value={metrics.backgroundJobFailures} />
      </div>
    </Card>
  );
}
