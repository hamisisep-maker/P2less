import { withTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import { Avatar } from "@/components/dashboard-ui";
import { PERMISSIONS, DEFAULT_USER_ROLES } from "@/lib/permissions";
import { InviteUserForm } from "./invite-user-form";
import { StaffRow } from "./staff-row";

// "Active" mirrors the exact query the admin overview's "Right now" stat
// uses (src/app/admin/page.tsx) — a real session touched in the last 15
// minutes, not a stale login timestamp.
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

export default async function UsersPage() {
  return withTenantUser(async (user) => {
    const tenantId = user.tenantId!;
    const canManage = userPermissions(user).includes(PERMISSIONS.USERS_MANAGE);
    const [users, roles, contacts] = await Promise.all([
      db.user.findMany({ where: { tenantId }, include: { userRoles: { include: { role: true } } }, orderBy: { createdAt: "asc" } }),
      db.role.findMany({ where: { tenantId }, orderBy: { key: "asc" } }),
      db.contact.findMany({ where: { tenantId }, include: { contactRoles: { include: { role: true } } }, orderBy: { createdAt: "asc" } }),
    ]);

    // Real gap found 2026-08-23 (asked directly, "so we can trace incase of
    // anything"): staff had no visibility into which of their own teammates
    // are actually active. One query, real session data, not inferred.
    const activeSessions = users.length
      ? await db.userSession.findMany({
          where: { userId: { in: users.map((u) => u.id) }, lastActiveAt: { gte: new Date(Date.now() - ACTIVE_WINDOW_MS) }, revokedAt: null, expiresAt: { gt: new Date() } },
          distinct: ["userId"],
          select: { userId: true },
        })
      : [];
    const activeUserIds = new Set(activeSessions.map((s) => s.userId));

    // Staff roles only — DEFAULT_CONTACT_ROLES (parent/end_user) exist in the
    // same tenant-scoped Role table but grant access to CONTACTS, not dashboard
    // Users; offering them here would let an invite silently assign the wrong
    // kind of role. No custom-role creation exists yet (grepped — every
    // tenant's roles are exactly the seeded defaults), so filtering by the
    // known staff-role keys is complete today, not just a heuristic.
    const staffRoleKeys = new Set(DEFAULT_USER_ROLES.map((r) => r.key));
    const staffRoles = roles.filter((r) => staffRoleKeys.has(r.key));

    return (
      <div>
        <PageHeader title="Users & roles" subtitle="Dashboard staff, conversational contacts, and the roles that grant them access." />

        {canManage && <InviteUserForm roles={staffRoles.map((r) => ({ id: r.id, name: r.name }))} />}

        <Card className="mb-4 p-5">
          <h2 className="mb-3 font-display font-semibold">Staff (dashboard users) — {activeUserIds.size} active now</h2>
          <div className="space-y-2">
            {users.map((u) => (
              <StaffRow
                key={u.id}
                id={u.id}
                name={u.name}
                email={u.email}
                roleNames={u.userRoles.map((ur) => ur.role.name)}
                active={activeUserIds.has(u.id)}
                deactivated={!!u.deactivatedAt}
                canManage={canManage}
                isSelf={u.id === user.id}
              />
            ))}
          </div>
        </Card>

        <Card className="mb-4 p-5">
          <h2 className="mb-3 font-display font-semibold">Contacts (conversational end users)</h2>
          <div className="space-y-2">
            {contacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5 transition-colors hover:bg-surface-2">
                <div className="flex items-center gap-2.5">
                  <Avatar name={c.displayName ?? c.address} size={30} />
                  <div><div className="text-sm font-medium">{c.displayName ?? c.address}</div><div className="text-xs text-muted">{c.address} · {c.channelType}</div></div>
                </div>
                <div className="flex gap-1">{c.contactRoles.map((cr) => <Badge key={cr.id}>{cr.role.name}</Badge>)}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-display font-semibold">Roles & permissions</h2>
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
  });
}
