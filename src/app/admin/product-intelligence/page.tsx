import { db } from "@/lib/db";
import { withAdminPermission } from "@/lib/admin-authz";
import { Card, PageHeader, Stat } from "@/components/ui";
import { SimpleAreaChart, InfoTip } from "@/components/dashboard-ui";
import { USE_CASE_OPTIONS, CHANNEL_OPTIONS } from "@/lib/tenant-options";
import { InterestTable, type InterestRow } from "./interest-table";

const TZ = process.env.APP_TIMEZONE || "Africa/Nairobi";
function dayKey(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: TZ });
}

// Phase 4, 2026-08-26 — reads BOTH the live snapshot (Tenant.useCases/
// channelsNeeded, for right-now aggregate counts and the use-case x channel
// cross-tab) and the real event history (TenantInterestEvent, for the trend
// chart) — the two questions "what's true right now" and "how did we get
// here" need different data sources, not one query pretending to answer both.
export default async function ProductIntelligencePage() {
  return withAdminPermission("product_intelligence.view", async () => {
    const since14 = new Date(); since14.setDate(since14.getDate() - 13); since14.setHours(0, 0, 0, 0);

    const [tenants, addedEvents] = await Promise.all([
      db.tenant.findMany({ select: { id: true, name: true, industry: true, useCases: true, channelsNeeded: true, exploreCompletedAt: true } }),
      db.tenantInterestEvent.findMany({ where: { action: "added", createdAt: { gte: since14 } }, select: { createdAt: true } }),
    ]);

    const rows: InterestRow[] = tenants.map((t) => ({
      id: t.id,
      name: t.name,
      industry: t.industry,
      useCases: (t.useCases as string[] | null) ?? [],
      channelsNeeded: (t.channelsNeeded as string[] | null) ?? [],
      exploreCompleted: !!t.exploreCompletedAt,
    }));

    // Aggregate counts + cross-tab — one pass over already-loaded tenants,
    // same manual-tally idiom admin/tenants/page.tsx uses for its byPlan
    // breakdown (useCases/channelsNeeded are JSON arrays, not a normalized
    // join table a real groupBy could target).
    const useCaseCounts = new Map<string, number>();
    const channelCounts = new Map<string, number>();
    const crossTab = new Map<string, number>(); // key: `${useCase}|${channel}`
    for (const r of rows) {
      for (const u of r.useCases) useCaseCounts.set(u, (useCaseCounts.get(u) ?? 0) + 1);
      for (const c of r.channelsNeeded) channelCounts.set(c, (channelCounts.get(c) ?? 0) + 1);
      for (const u of r.useCases) for (const c of r.channelsNeeded) {
        const key = `${u}|${c}`;
        crossTab.set(key, (crossTab.get(key) ?? 0) + 1);
      }
    }
    const totalInterested = rows.filter((r) => r.useCases.length > 0 || r.channelsNeeded.length > 0).length;
    const maxUseCase = Math.max(1, ...useCaseCounts.values());
    const maxChannel = Math.max(1, ...channelCounts.values());

    // 14-day trend — identical day-bucketing pattern to admin/page.tsx's
    // own platform-growth chart.
    const buckets = new Map<string, number>();
    for (let i = 0; i < 14; i++) { const d = new Date(since14); d.setDate(d.getDate() + i); buckets.set(dayKey(d), 0); }
    for (const e of addedEvents) { const k = dayKey(e.createdAt); if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1); }
    const trendData = [...buckets.entries()].map(([date, added]) => ({ date, added }));

    return (
      <div>
        <PageHeader title="Product Intelligence" subtitle="What organizations actually say they want to use P2Less for — self-reported via Explore and Settings, not usage data." />

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total tenants" value={rows.length} />
          <Stat label="Expressed any interest" value={totalInterested} sub={`${rows.length ? Math.round((totalInterested / rows.length) * 100) : 0}% of tenants`} />
          <Stat label="Completed Explore" value={rows.filter((r) => r.exploreCompleted).length} />
          <Stat label="Interest changes, last 14 days" value={addedEvents.length} />
        </div>

        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 font-display font-semibold">What they want to use it for</h2>
            <div className="space-y-2.5">
              {USE_CASE_OPTIONS.map((o) => {
                const count = useCaseCounts.get(o.value) ?? 0;
                return (
                  <div key={o.value}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted">{o.label}</span>
                      <span className="font-medium tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-accent-ink))]" style={{ width: `${(count / maxUseCase) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-display font-semibold">Which channels their customers use</h2>
            <div className="space-y-2.5">
              {CHANNEL_OPTIONS.map((o) => {
                const count = channelCounts.get(o.value) ?? 0;
                return (
                  <div key={o.value}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted">{o.label}</span>
                      <span className="font-medium tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,#6366f1,#4338ca)]" style={{ width: `${(count / maxChannel) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <Card className="mb-4 p-5">
          <div className="mb-3 flex items-center gap-1.5">
            <h2 className="font-display font-semibold">Use case × channel</h2>
            <InfoTip text="How many tenants selected both — click a count in the table below to see exactly which organizations." />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-faint">Use case</th>
                  {CHANNEL_OPTIONS.map((c) => (
                    <th key={c.value} className="border-b border-line px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-faint">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {USE_CASE_OPTIONS.map((u) => (
                  <tr key={u.value} className="border-b border-line-soft last:border-0">
                    <td className="px-3 py-2 text-muted">{u.label}</td>
                    {CHANNEL_OPTIONS.map((c) => {
                      const count = crossTab.get(`${u.value}|${c.value}`) ?? 0;
                      return (
                        <td key={c.value} className="px-3 py-2 text-center tabular-nums">
                          {count > 0 ? <span className="font-medium text-accent-ink">{count}</span> : <span className="text-faint">·</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="mb-4 p-5">
          <div className="mb-1 flex items-center gap-1.5">
            <h2 className="font-display font-semibold">Interest changes, last 14 days</h2>
            <InfoTip text="Values added to useCases/channelsNeeded via Explore or Settings — a real recorded event, not the current snapshot." />
          </div>
          <SimpleAreaChart data={trendData} dataKey="added" name="Interest added" />
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-display font-semibold">Every organization</h2>
          <InterestTable data={rows} />
        </Card>
      </div>
    );
  });
}
