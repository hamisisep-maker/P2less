import { db } from "@/lib/db";
import { Card, PageHeader, Stat } from "@/components/ui";
import { withAdminPermission } from "@/lib/admin-authz";
import { TenantsAdminTable, type AdminTenantRow } from "./tenants-table";

export default async function AdminTenantsPage() {
  return withAdminPermission("tenants.view", async () => {
    const tenants = await db.tenant.findMany({
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { users: true, connectors: true, contacts: true } },
        payments: { where: { status: "paid" }, select: { amount: true, paidAt: true } },
        // Real gap found 2026-08-23 (asked directly — "I have not seen the
        // tenant full details... such as email"): the owner's email was never
        // shown anywhere on this page, even though it's the one thing you'd
        // actually need to reach a tenant. First-created staff account, same
        // "owner" assumption finalizeOnboarding itself makes.
        users: { take: 1, orderBy: { createdAt: "asc" }, select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const rows: AdminTenantRow[] = tenants.map((t) => ({
      id: t.id,
      name: t.name,
      industry: t.industry,
      plan: t.subscription?.plan.name ?? "no plan",
      status: t.status,
      users: t._count.users,
      connectors: t._count.connectors,
      contacts: t._count.contacts,
      totalPaidKes: t.payments.reduce((s, p) => s + p.amount, 0),
      lastPaymentAt: t.payments.reduce<Date | null>((latest, p) => (p.paidAt && (!latest || p.paidAt > latest) ? p.paidAt : latest), null),
      ownerName: t.users[0]?.name ?? null,
      ownerEmail: t.users[0]?.email ?? null,
    }));

    // Real gap found 2026-08-23, asked directly ("do we track how many people
    // we have per tier"): confirmed nowhere in the app before this — no
    // groupBy plan/industry breakdown existed anywhere, admin or tenant side.
    // A real count over the same rows already loaded above, not a new query.
    const byPlan = new Map<string, number>();
    for (const r of rows) byPlan.set(r.plan, (byPlan.get(r.plan) ?? 0) + 1);
    const planCounts = [...byPlan.entries()].sort((a, b) => b[1] - a[1]);

    return (
      <div>
        <PageHeader title="Tenants" subtitle="Every organization on P2Less — suspend access instantly if something goes wrong, reactivate the moment it's resolved." />
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total tenants" value={rows.length} />
          {planCounts.slice(0, 3).map(([plan, count]) => <Stat key={plan} label={plan} value={count} sub="tenants" />)}
        </div>
        <Card className="p-5">
          <TenantsAdminTable data={rows} />
        </Card>
      </div>
    );
  });
}
