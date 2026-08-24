import { withTenantUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/platform-settings";
import { Badge } from "@/components/ui";
import { NotificationBell, UserMenu, LiveClock, type NotifItem } from "@/components/dashboard-ui";
import { SidebarShell } from "@/components/sidebar-shell";
import { MaintenanceScreen } from "@/components/maintenance-screen";
import { resolveVisibleNav } from "@/lib/nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return withTenantUser(async (user) => {
    const tenantId = user.tenantId!;

    // Whole-platform maintenance (src/lib/maintenance-actions.ts) blocks tenant
    // staff from the dashboard — platform admins are unaffected (separate
    // /admin layout) so they can always turn it back off.
    const maintenanceEnabled = await getSetting("maintenance_enabled");
    if (maintenanceEnabled === "1") {
      const message = await getSetting("maintenance_message");
      return <MaintenanceScreen message={message} onLogout={logoutAction} />;
    }

    const [escalated, lowStock, outOfStock, connectorCount, apiKeyCount, webhookCount, productCount, widgetKeyCount] = await Promise.all([
      db.conversation.count({ where: { tenantId, status: "escalated" } }),
      db.product.findMany({ where: { tenantId, stockQuantity: { not: null, gt: 0, lte: 5 } }, select: { name: true, stockQuantity: true }, take: 5 }),
      db.product.count({ where: { tenantId, OR: [{ stockQuantity: 0 }, { inStock: false }] } }),
      db.connector.count({ where: { tenantId } }),
      db.apiKey.count({ where: { tenantId } }),
      db.webhook.count({ where: { tenantId } }),
      db.product.count({ where: { tenantId } }),
      db.widgetKey.count({ where: { tenantId } }),
    ]);

    // Registration reframe Track B — capability-based nav (see nav.ts). Self-
    // reported useCases/channelsNeeded, empty for every pre-existing tenant,
    // fall back cleanly to the real data-presence signals above.
    const navItems = resolveVisibleNav({
      useCases: (user.tenant?.useCases as string[] | null) ?? [],
      channelsNeeded: (user.tenant?.channelsNeeded as string[] | null) ?? [],
      hasConnectors: connectorCount > 0,
      hasApiActivity: apiKeyCount > 0 || webhookCount > 0,
      hasProducts: productCount > 0,
      hasWidgetKey: widgetKeyCount > 0,
    });

    const notifications: NotifItem[] = [
      ...(escalated > 0 ? [{ id: "escalated", title: `${escalated} conversation${escalated === 1 ? "" : "s"} escalated`, detail: "Waiting on a human reply", tone: "rose" as const, href: "/dashboard/conversations" }] : []),
      ...(outOfStock > 0 ? [{ id: "oos", title: `${outOfStock} product${outOfStock === 1 ? "" : "s"} out of stock`, detail: "Customers can't order these right now", tone: "amber" as const, href: "/dashboard/products" }] : []),
      ...lowStock.map((p) => ({ id: `low-${p.name}`, title: `${p.name} running low`, detail: `Only ${p.stockQuantity} left`, tone: "amber" as const, href: "/dashboard/products" })),
    ];

    return (
      <div className="min-h-screen lg:flex lg:h-screen lg:overflow-hidden">
        {/* Sidebar — deliberately its own dark palette (var(--color-side-*)), scrolls on its own on desktop */}
        <SidebarShell
          navItems={navItems}
          footer={
            <div className="mt-auto hidden border-t border-side-line p-4 lg:block">
              <div className="flex items-center justify-between">
                <span className="text-xs text-side-text">{user.tenant?.name}</span>
                <Badge tone="green" dot>live</Badge>
              </div>
            </div>
          }
        />
        {/* Main — scrolls independently of the sidebar */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:h-screen">
          <header className="flex items-center justify-between gap-2.5 border-b border-line bg-surface/80 px-5 py-3 backdrop-blur-md sm:px-8">
            <LiveClock />
            <div className="flex items-center gap-2.5">
              <NotificationBell items={notifications} />
              <UserMenu name={user.name} orgName={user.tenant?.name ?? ""} profileHref="/dashboard/profile" logoutAction={logoutAction} />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,_var(--color-accent-soft),_transparent_45%)] p-5 sm:p-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    );
  });
}
