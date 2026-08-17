import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";

export default async function UsersPage() {
  const user = await requireTenantUser();
  const tenantId = user.tenantId!;
  const [users, roles, contacts] = await Promise.all([
    db.user.findMany({ where: { tenantId }, include: { userRoles: { include: { role: true } } }, orderBy: { createdAt: "asc" } }),
    db.role.findMany({ where: { tenantId }, orderBy: { key: "asc" } }),
    db.contact.findMany({ where: { tenantId }, include: { contactRoles: { include: { role: true } } }, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader title="Users & roles" subtitle="Dashboard staff, conversational contacts, and the roles that grant them access." />

      <Card className="mb-4 p-5">
        <h2 className="mb-3 font-semibold">Staff (dashboard users)</h2>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5">
              <div><div className="text-sm font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></div>
              <div className="flex gap-1">{u.userRoles.map((ur) => <Badge key={ur.id} tone="accent">{ur.role.name}</Badge>)}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-3 font-semibold">Contacts (conversational end users)</h2>
        <div className="space-y-2">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5">
              <div><div className="text-sm font-medium">{c.displayName ?? c.address}</div><div className="text-xs text-muted">{c.address} · {c.channelType}</div></div>
              <div className="flex gap-1">{c.contactRoles.map((cr) => <Badge key={cr.id}>{cr.role.name}</Badge>)}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Roles & permissions</h2>
        <div className="space-y-2">
          {roles.map((r) => (
            <div key={r.id} className="rounded-xl border border-line px-3.5 py-2.5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{r.name}</div>
                <span className="font-mono text-[11px] text-faint">{r.key}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {((r.permissions as string[]) ?? []).map((p) => <span key={p} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{p}</span>)}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
