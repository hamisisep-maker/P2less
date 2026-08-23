import { requireSuperAdmin } from "@/lib/auth";
import { hasAdminPermission } from "@/lib/admin-authz";
import { logoutAction } from "@/lib/actions";
import { Badge } from "@/components/ui";
import { UserMenu, LiveClock } from "@/components/dashboard-ui";
import { SidebarShell } from "@/components/sidebar-shell";
import { ADMIN_NAV } from "@/lib/admin-nav";
import type { AdminPermission } from "@/lib/admin-permissions";

// Nav items that need a specific permission to be worth showing at all — not
// a security boundary (every page/action re-checks itself), just avoids
// dead-end links to pages a role would immediately be redirected away from.
const NAV_PERMISSION: Partial<Record<string, AdminPermission>> = {
  "/admin/tenants": "tenants.view",
  "/admin/billing": "billing.view",
  "/admin/ai": "providers.view",
  "/admin/models": "models.view",
  "/admin/system-health": "system_health.view",
  "/admin/integrations": "integrations.view",
  "/admin/reconciliation": "reconciliation.view",
  "/admin/incidents": "incidents.view",
  "/admin/tickets": "tickets.view",
  "/admin/quality": "tickets.view",
  "/admin/roles": "roles.manage",
  "/admin/security": "security.manage",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();
  const roleName = user.adminRole?.name ?? (user.isSuperAdmin ? "Super Admin" : "Admin");
  const navItems = ADMIN_NAV.filter((item) => {
    const perm = NAV_PERMISSION[item.href];
    return !perm || hasAdminPermission(user, perm);
  });

  return (
    <div className="min-h-screen lg:flex lg:h-screen lg:overflow-hidden">
      <SidebarShell
        navItems={navItems}
        exactRoot="/admin"
        footer={
          <div className="mt-auto hidden border-t border-side-line p-4 lg:block">
            <div className="flex items-center justify-between">
              <span className="text-xs text-side-text">{roleName}</span>
              <Badge tone="green" dot>live</Badge>
            </div>
          </div>
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:h-screen">
        <header className="flex items-center justify-between gap-2.5 border-b border-line bg-surface/80 px-5 py-3 backdrop-blur-md sm:px-8">
          <LiveClock />
          <UserMenu name={user.name} orgName={roleName} profileHref="/admin/settings" logoutAction={logoutAction} />
        </header>
        <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,_var(--color-accent-soft),_transparent_45%)] p-5 sm:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
