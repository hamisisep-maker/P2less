import { requireSuperAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { Card, Stat, PageHeader, Badge, Logo } from "@/components/ui";

export default async function AdminPage() {
  await requireSuperAdmin();
  const [tenants, plans, totalConvos, totalMsgs] = await Promise.all([
    db.tenant.findMany({ include: { subscription: { include: { plan: true } }, _count: { select: { users: true, connectors: true, contacts: true } } }, orderBy: { createdAt: "asc" } }),
    db.plan.findMany({ orderBy: { sort: "asc" } }),
    db.conversation.count(),
    db.usageEvent.aggregate({ where: { type: "message_in" }, _sum: { quantity: true } }),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-10">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <form action={logoutAction}><button className="text-sm text-rose hover:underline">Sign out</button></form>
      </div>
      <PageHeader title="Platform administration" subtitle="P2Less Super Admin — tenants, plans, and platform-wide usage." />

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Tenants" value={tenants.length} />
        <Stat label="Plans" value={plans.length} />
        <Stat label="Conversations" value={totalConvos} />
        <Stat label="Inbound messages" value={totalMsgs._sum.quantity ?? 0} />
      </div>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-semibold">Tenants</h2>
        <div className="space-y-2">
          {tenants.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <div>
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted">{t.industry} · {t._count.users} staff · {t._count.connectors} connectors · {t._count.contacts} contacts</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="accent">{t.subscription?.plan.name ?? "no plan"}</Badge>
                <Badge tone={t.status === "active" ? "green" : "amber"}>{t.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-semibold">Subscription plans</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const limits = (p.limits as Record<string, number>) ?? {};
            return (
              <div key={p.id} className="rounded-xl border border-line p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{p.name}</div>
                  {p.whiteLabel && <Badge tone="accent">white-label</Badge>}
                </div>
                <div className="mt-1 text-sm text-muted">{p.priceMonthly === 0 ? "Free" : `${p.priceMonthly} / mo`}</div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted">
                  <li>{limits.users ?? "∞"} users</li>
                  <li>{limits.messagesPerMonth ?? "∞"} messages/mo</li>
                  <li>{limits.connectors ?? "∞"} connectors</li>
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-faint">Plans are configurable (stored in the Plan model), not hard-coded into the app.</p>
      </Card>
    </div>
  );
}
