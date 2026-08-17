import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthlyUsage } from "@/lib/usage";
import { Card, Stat, PageHeader, Badge } from "@/components/ui";

export default async function Overview() {
  const user = await requireTenantUser();
  const tenantId = user.tenantId!;

  const [msgIn, msgOut, apiCalls, docs, conversations, connectors, contacts, sub] = await Promise.all([
    monthlyUsage(tenantId, "message_in"),
    monthlyUsage(tenantId, "message_out"),
    monthlyUsage(tenantId, "api_call"),
    monthlyUsage(tenantId, "document"),
    db.conversation.count({ where: { tenantId } }),
    db.connector.findMany({ where: { tenantId }, include: { _count: { select: { actions: true } } } }),
    db.contact.count({ where: { tenantId } }),
    db.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
  ]);

  const recent = await db.conversation.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    take: 6,
    include: { contact: true, _count: { select: { messages: true } } },
  });

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        subtitle={`${user.tenant?.name} · ${sub?.plan.name ?? "No plan"} plan`}
        action={<Link href="/dashboard/connectors/new" className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-ink">Add integration</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Messages in" value={msgIn} sub="this month" />
        <Stat label="Messages out" value={msgOut} sub="this month" />
        <Stat label="API calls" value={apiCalls} sub="to connected systems" />
        <Stat label="Documents" value={docs} sub="generated" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Connected systems</h2>
            <Link href="/dashboard/connectors" className="text-xs text-accent hover:underline">Manage →</Link>
          </div>
          <div className="space-y-2">
            {connectors.length === 0 && <p className="text-sm text-muted">No systems connected yet.</p>}
            {connectors.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5">
                <div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted">{c._count.actions} action(s) · {c.baseUrl}</div>
                </div>
                <Badge tone={c.lastOk === false ? "rose" : c.lastOk ? "green" : "neutral"}>
                  {c.lastOk === false ? "error" : c.lastOk ? "healthy" : "untested"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Recent conversations</h2>
            <Link href="/dashboard/conversations" className="text-xs text-accent hover:underline">All →</Link>
          </div>
          <div className="space-y-2">
            {recent.length === 0 && <p className="text-sm text-muted">No conversations yet. Try the demo chat.</p>}
            {recent.map((c) => (
              <Link key={c.id} href={`/dashboard/conversations/${c.id}`} className="flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5 hover:bg-surface-2">
                <div>
                  <div className="text-sm font-medium">{c.contact.displayName ?? c.contact.address}</div>
                  <div className="text-xs text-muted">{c._count.messages} messages · {c.contact.channelType}</div>
                </div>
                <Badge tone={c.status === "escalated" ? "amber" : c.status === "open" ? "neutral" : "accent"}>{c.status}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Contacts" value={contacts} sub="conversational end users" />
        <Stat label="Conversations" value={conversations} sub="all time" />
        <Stat label="Plan" value={sub?.plan.name ?? "—"} sub={sub ? `renews ${sub.renewsAt.toLocaleDateString()}` : ""} />
      </div>
    </div>
  );
}
