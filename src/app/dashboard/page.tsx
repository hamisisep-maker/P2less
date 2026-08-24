import Link from "next/link";
import { MessageSquareText, Send, Plug, FileText, Plus } from "lucide-react";
import { withTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthlyUsage } from "@/lib/usage";
import { Card, Stat, PageHeader, Badge, timeAgo } from "@/components/ui";
import { Trend, Modal, InfoTip, TrendAreaChart, StatusPieChart, ConversationsTable, IconStat, type ConvoRow } from "@/components/dashboard-ui";

const TZ = process.env.APP_TIMEZONE || "Africa/Nairobi";

function dayKey(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: TZ });
}

export default async function Overview() {
  return withTenantUser(async (user) => {
    const tenantId = user.tenantId!;

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const since14 = new Date(now); since14.setDate(since14.getDate() - 13); since14.setHours(0, 0, 0, 0);

    const [
      msgIn, msgOut, apiCalls, docs,
      msgInPrev, msgOutPrev,
      conversations, connectors, contacts, sub,
      recentEvents, statusGroups, tenantFaqs,
    ] = await Promise.all([
      monthlyUsage(tenantId, "message_in"),
      monthlyUsage(tenantId, "message_out"),
      monthlyUsage(tenantId, "api_call"),
      monthlyUsage(tenantId, "document"),
      db.usageEvent.aggregate({ where: { tenantId, type: "message_in", createdAt: { gte: startOfLastMonth, lt: startOfThisMonth } }, _sum: { quantity: true } }),
      db.usageEvent.aggregate({ where: { tenantId, type: "message_out", createdAt: { gte: startOfLastMonth, lt: startOfThisMonth } }, _sum: { quantity: true } }),
      db.conversation.count({ where: { tenantId } }),
      db.connector.findMany({ where: { tenantId }, include: { _count: { select: { actions: true } }, actions: { select: { key: true, method: true, operation: true } } } }),
      db.contact.count({ where: { tenantId } }),
      db.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      db.usageEvent.findMany({ where: { tenantId, type: { in: ["message_in", "message_out"] }, createdAt: { gte: since14 } }, select: { type: true, quantity: true, createdAt: true } }),
      db.conversation.groupBy({ by: ["status"], where: { tenantId }, _count: true }),
      db.tenant.findUnique({ where: { id: tenantId }, select: { faqs: true } }),
    ]);
    const faqCount = Array.isArray(tenantFaqs?.faqs) ? (tenantFaqs.faqs as { q: string; a: string }[]).filter((f) => f?.q && f?.a).length : 0;

    const recent = await db.conversation.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      take: 25,
      include: { contact: true, _count: { select: { messages: true } } },
    });

    // Bucket the last 14 days of message volume for the trend chart.
    const buckets = new Map<string, { in: number; out: number }>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(since14); d.setDate(d.getDate() + i);
      buckets.set(dayKey(d), { in: 0, out: 0 });
    }
    for (const e of recentEvents) {
      const k = dayKey(e.createdAt);
      const b = buckets.get(k);
      if (!b) continue;
      if (e.type === "message_in") b.in += e.quantity; else b.out += e.quantity;
    }
    const chartData = [...buckets.entries()].map(([date, v]) => ({ date, ...v }));

    // Collapse the many transient awaiting_* statuses into a simple open/escalated/closed split.
    let openCount = 0, escalatedCount = 0, closedCount = 0;
    for (const g of statusGroups) {
      if (g.status === "escalated") escalatedCount += g._count;
      else if (g.status === "closed") closedCount += g._count;
      else openCount += g._count;
    }
    const pieData = [
      { name: "open", value: openCount },
      { name: "escalated", value: escalatedCount },
      { name: "closed", value: closedCount },
    ];

    const tableData: ConvoRow[] = recent.map((c) => ({
      id: c.id,
      name: c.contact.displayName ?? c.contact.address,
      channel: c.contact.channelType,
      messages: c._count.messages,
      status: c.status,
      updated: c.updatedAt,
    }));

    return (
      <div>
        <PageHeader
          title={`Welcome, ${user.name.split(" ")[0]}`}
          subtitle={`${user.tenant?.name} · ${sub?.plan.name ?? "No plan"} plan`}
          action={<Link href="/dashboard/connectors/new" className="flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5"><Plus size={15} /> Add integration</Link>}
        />

        {faqCount === 0 && (
          <Card className="mb-4 border-amber/30 bg-amber-soft p-4 text-sm">
            <p className="mb-1 font-medium text-amber">No FAQs added yet</p>
            <p className="text-muted">
              Right now your assistant can only handle bookable actions and general conversation — for anything else it honestly says it doesn&apos;t have the answer rather than guessing. Add a few common questions, or scan your website to draft some automatically. <Link href="/dashboard/faqs" className="text-accent hover:underline">Add FAQs →</Link>
            </p>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <IconStat icon={<MessageSquareText size={17} />} label="Messages in" value={msgIn} tip="Inbound messages this calendar month." trend={<Trend current={msgIn} previous={msgInPrev._sum.quantity ?? 0} />} tone="accent" />
          <IconStat icon={<Send size={17} />} label="Messages out" value={msgOut} tip="Replies sent out this calendar month." trend={<Trend current={msgOut} previous={msgOutPrev._sum.quantity ?? 0} />} tone="indigo" />
          <IconStat icon={<Plug size={17} />} label="API calls" value={apiCalls} tip="Calls made to your connected systems this month." tone="amber" />
          <IconStat icon={<FileText size={17} />} label="Documents" value={docs} tip="PDFs/statements generated this month." tone="rose" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="mb-1 flex items-center gap-1.5">
              <h2 className="font-display font-semibold">Message volume</h2>
              <InfoTip text="Inbound vs outbound messages over the last 14 days." />
            </div>
            <TrendAreaChart data={chartData} />
          </Card>
          <Card className="p-5">
            <div className="mb-1 flex items-center gap-1.5">
              <h2 className="font-display font-semibold">Conversation status</h2>
              <InfoTip text="All-time breakdown of every conversation on this number." />
            </div>
            <StatusPieChart data={pieData} />
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display font-semibold">Connected systems</h2>
              <Link href="/dashboard/connectors" className="text-xs text-accent hover:underline">Manage →</Link>
            </div>
            <div className="space-y-2">
              {connectors.length === 0 && <p className="text-sm text-muted">No systems connected yet.</p>}
              {connectors.map((c) => (
                <Modal
                  key={c.id}
                  title={c.name}
                  description={c.baseUrl}
                  trigger={
                    <button className="flex w-full items-center justify-between rounded-xl border border-line px-3.5 py-2.5 text-left hover:bg-surface-2">
                      <div>
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="text-xs text-muted">{c._count.actions} action(s) · {c.baseUrl}</div>
                      </div>
                      <Badge tone={c.lastOk === false ? "rose" : c.lastOk ? "green" : "neutral"}>
                        {c.lastOk === false ? "error" : c.lastOk ? "healthy" : "untested"}
                      </Badge>
                    </button>
                  }
                >
                  <div className="space-y-3 text-sm">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                      <span>Kind: <b className="text-ink">{c.kind}</b></span>
                      <span>Auth: <b className="text-ink">{c.authType}</b></span>
                      <span>Status: <b className="text-ink">{c.status}</b></span>
                      {c.lastCheckAt && <span>Checked: <b className="text-ink">{timeAgo(c.lastCheckAt)}</b></span>}
                    </div>
                    <div>
                      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-faint">Actions ({c.actions.length})</div>
                      <div className="max-h-56 space-y-1 overflow-y-auto">
                        {c.actions.map((a) => (
                          <div key={a.key} className="flex items-center justify-between rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
                            <span className="font-mono">{a.key}</span>
                            <Badge tone={a.operation === "write" ? "amber" : "neutral"}>{a.method}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </Modal>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display font-semibold">Snapshot</h2>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Contacts" value={contacts} sub="end users" />
              <Stat label="Conversations" value={conversations} sub="all time" />
              <Stat label="Plan" value={sub?.plan.name ?? "—"} sub={sub ? `renews ${sub.renewsAt.toLocaleDateString()}` : ""} />
            </div>
          </Card>
        </div>

        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display font-semibold">Recent conversations</h2>
            <Link href="/dashboard/conversations" className="text-xs text-accent hover:underline">All →</Link>
          </div>
          <ConversationsTable data={tableData} pageSize={8} />
        </Card>
      </div>
    );
  });
}
