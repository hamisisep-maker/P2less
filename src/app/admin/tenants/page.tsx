import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { requireAdminPermission } from "@/lib/admin-authz";
import { TenantsAdminTable, type AdminTenantRow } from "./tenants-table";

export default async function AdminTenantsPage() {
  await requireAdminPermission("tenants.view");
  const tenants = await db.tenant.findMany({
    include: {
      subscription: { include: { plan: true } },
      _count: { select: { users: true, connectors: true, contacts: true } },
      payments: { where: { status: "paid" }, select: { amount: true, paidAt: true } },
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
  }));

  return (
    <div>
      <PageHeader title="Tenants" subtitle="Every organization on P2Less — suspend access instantly if something goes wrong, reactivate the moment it's resolved." />
      <Card className="p-5">
        <TenantsAdminTable data={rows} />
      </Card>
    </div>
  );
}
