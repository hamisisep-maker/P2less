import { db } from "@/lib/db";
import { requireAdminPermission } from "@/lib/admin-authz";
import { Card, PageHeader } from "@/components/ui";
import { RoleCard } from "./role-card";
import { AdminRow } from "./admin-row";
import { CreateRoleModal } from "./create-role-modal";

export default async function AdminRolesPage() {
  const me = await requireAdminPermission("roles.manage");

  const [roles, admins, tenants] = await Promise.all([
    db.adminRole.findMany({ include: { _count: { select: { users: true } } }, orderBy: { createdAt: "asc" } }),
    db.user.findMany({
      where: { OR: [{ isSuperAdmin: true }, { adminRoleId: { not: null } }] },
      include: { adminRole: true },
      orderBy: { name: "asc" },
    }),
    db.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const tenantNameById = new Map(tenants.map((t) => [t.id, t.name]));
  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name, key: r.key }));

  return (
    <div>
      <PageHeader
        title="Roles & access"
        subtitle="Users → Roles → Permissions → Resources → Actions → Scope → Audit. Six built-in roles to start — create more as the team grows."
        action={<CreateRoleModal />}
      />

      <Card className="p-5">
        <h2 className="mb-3 font-display font-semibold">Roles</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <RoleCard
              key={r.id}
              role={{ id: r.id, key: r.key, name: r.name, permissions: (r.permissions as string[]) ?? [], isBuiltIn: r.isBuiltIn, assignedCount: r._count.users }}
            />
          ))}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Platform admins</h2>
        <p className="mb-3 text-xs text-muted">Every account with access to /admin. New admin accounts are provisioned outside this UI today; this page controls which role and tenant scope an existing account holds.</p>
        <div className="space-y-2">
          {admins.map((a) => (
            <AdminRow
              key={a.id}
              admin={{
                id: a.id, name: a.name, email: a.email,
                roleName: a.adminRole?.name ?? (a.isSuperAdmin ? "Super Admin" : null),
                roleKey: a.adminRole?.key ?? (a.isSuperAdmin ? "super_admin" : null),
                isSuperAdmin: a.isSuperAdmin,
                adminScope: (a.adminScope as string[] | null) ?? null,
                scopeNames: ((a.adminScope as string[] | null) ?? []).map((id) => tenantNameById.get(id) ?? id),
              }}
              isSelf={a.id === me.id}
              roles={roleOptions}
              tenants={tenants}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
