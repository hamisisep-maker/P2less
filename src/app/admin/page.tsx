import Link from "next/link";
import { Building2, MessagesSquare, Send, ShieldAlert, Wallet, BrainCircuit, Settings, ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge, timeAgo } from "@/components/ui";
import { IconStat, SimpleAreaChart, InfoTip } from "@/components/dashboard-ui";

const TZ = process.env.APP_TIMEZONE || "Africa/Nairobi";
function dayKey(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: TZ });
}

export default async function AdminPage() {
  const since14 = new Date(); since14.setDate(since14.getDate() - 13); since14.setHours(0, 0, 0, 0);
  const today = new Date().toISOString().slice(0, 10);

  const [tenants, totalConvos, totalMsgs, growthEvents, suspended, pastDue, aiStatsToday, recentActivity] = await Promise.all([
    db.tenant.count(),
    db.conversation.count(),
    db.usageEvent.aggregate({ where: { type: "message_in" }, _sum: { quantity: true } }),
    db.usageEvent.findMany({ where: { type: "message_in", createdAt: { gte: since14 } }, select: { quantity: true, createdAt: true } }),
    db.tenant.count({ where: { status: "suspended" } }),
    db.subscription.count({ where: { status: "past_due" } }),
    db.aiProviderStat.findMany({ where: { date: today } }),
    db.platformAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  const buckets = new Map<string, number>();
  for (let i = 0; i < 14; i++) { const d = new Date(since14); d.setDate(d.getDate() + i); buckets.set(dayKey(d), 0); }
  for (const e of growthEvents) { const k = dayKey(e.createdAt); if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + e.quantity); }
  const growthData = [...buckets.entries()].map(([date, messages]) => ({ date, messages }));

  const aiIssues = aiStatsToday.filter((s) => s.failures > 0 && s.successes === 0).length;
  const needsAttention = suspended > 0 || pastDue > 0 || aiIssues > 0;

  const quickLinks = [
    { href: "/admin/tenants", label: "Tenants", desc: "Manage organizations, suspend or reactivate access", icon: Building2, tone: "accent" },
    { href: "/admin/billing", label: "Billing & Revenue", desc: "Real payments, platform P&L, plan pricing calculator", icon: Wallet, tone: "indigo" },
    { href: "/admin/ai", label: "AI Providers", desc: "Usage, quota, cost tracking, top up credits", icon: BrainCircuit, tone: "amber" },
    { href: "/admin/settings", label: "Settings", desc: "Your admin profile and password", icon: Settings, tone: "rose" },
  ] as const;

  return (
    <div>
      <PageHeader title="Platform administration" subtitle="Every tenant, plan, and AI provider on P2Less — one control tower." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <IconStat icon={<Building2 size={17} />} label="Tenants" value={tenants} tip="Organizations running on P2Less." tone="accent" />
        <IconStat icon={<MessagesSquare size={17} />} label="Conversations" value={totalConvos} tip="All-time, across every tenant." tone="indigo" />
        <IconStat icon={<Send size={17} />} label="Inbound messages" value={totalMsgs._sum.quantity ?? 0} tip="All-time inbound message volume." tone="amber" />
        <IconStat icon={<ShieldAlert size={17} />} label="Needs attention" value={suspended + pastDue + aiIssues} tip="Suspended tenants + past-due subscriptions + failing AI providers." tone="rose" />
      </div>

      {needsAttention && (
        <Card className="mt-4 border-rose/30 bg-rose-soft/40 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ShieldAlert size={16} className="text-rose" />
            <span className="font-medium">Needs attention:</span>
            {suspended > 0 && <Badge tone="rose">{suspended} suspended tenant{suspended === 1 ? "" : "s"}</Badge>}
            {pastDue > 0 && <Badge tone="amber">{pastDue} past-due subscription{pastDue === 1 ? "" : "s"}</Badge>}
            {aiIssues > 0 && <Badge tone="rose">{aiIssues} AI provider{aiIssues === 1 ? "" : "s"} failing</Badge>}
          </div>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">Platform growth</h2>
          <InfoTip text="Inbound messages across every tenant, last 14 days." />
        </div>
        <SimpleAreaChart data={growthData} dataKey="messages" name="Messages in" />
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {quickLinks.map((q) => (
          <Link key={q.href} href={q.href} className="group">
            <Card hover className="flex items-center gap-4 p-5">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-[var(--shadow-accent-glow)] ${
                q.tone === "accent" ? "bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))]"
                : q.tone === "indigo" ? "bg-[linear-gradient(135deg,#6366f1,#4338ca)]"
                : q.tone === "amber" ? "bg-[linear-gradient(135deg,#f59e0b,#b45309)]"
                : "bg-[linear-gradient(135deg,#fb7185,#be123c)]"
              }`}>
                <q.icon size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold">{q.label}</div>
                <div className="text-xs text-muted">{q.desc}</div>
              </div>
              <ArrowRight size={16} className="shrink-0 text-faint transition-transform group-hover:translate-x-1 group-hover:text-accent" />
            </Card>
          </Link>
        ))}
      </div>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Recent admin activity</h2>
        {recentActivity.length === 0 && <p className="text-sm text-muted">No platform-level changes yet.</p>}
        <div className="space-y-2">
          {recentActivity.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
              <div>
                <span className="font-medium">{a.action.replace("admin.", "").replace(/_/g, " ")}</span>
                {a.target && <span className="text-muted"> · {a.target}</span>}
                <span className="text-xs text-faint"> · {a.actorEmail}</span>
              </div>
              <span className="text-xs text-faint">{timeAgo(a.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
