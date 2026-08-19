import { requireTenantUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { Logo, Badge } from "@/components/ui";
import { NotificationBell, UserMenu, LiveClock, type NotifItem } from "@/components/dashboard-ui";
import { SidebarNav } from "@/components/sidebar-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireTenantUser();
  const tenantId = user.tenantId!;

  const [escalated, lowStock, outOfStock] = await Promise.all([
    db.conversation.count({ where: { tenantId, status: "escalated" } }),
    db.product.findMany({ where: { tenantId, stockQuantity: { not: null, gt: 0, lte: 5 } }, select: { name: true, stockQuantity: true }, take: 5 }),
    db.product.count({ where: { tenantId, OR: [{ stockQuantity: 0 }, { inStock: false }] } }),
  ]);

  const notifications: NotifItem[] = [
    ...(escalated > 0 ? [{ id: "escalated", title: `${escalated} conversation${escalated === 1 ? "" : "s"} escalated`, detail: "Waiting on a human reply", tone: "rose" as const, href: "/dashboard/conversations" }] : []),
    ...(outOfStock > 0 ? [{ id: "oos", title: `${outOfStock} product${outOfStock === 1 ? "" : "s"} out of stock`, detail: "Customers can't order these right now", tone: "amber" as const, href: "/dashboard/products" }] : []),
    ...lowStock.map((p) => ({ id: `low-${p.name}`, title: `${p.name} running low`, detail: `Only ${p.stockQuantity} left`, tone: "amber" as const, href: "/dashboard/products" })),
  ];

  return (
    <div className="min-h-screen lg:grid lg:h-screen lg:grid-cols-[260px_1fr] lg:overflow-hidden">
      {/* Sidebar — deliberately its own dark palette (var(--color-side-*)), scrolls on its own on desktop */}
      <aside className="flex flex-col border-b border-side-line bg-side-bg lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="p-5"><Logo dark /></div>
        <SidebarNav />
        <div className="mt-auto hidden border-t border-side-line p-4 lg:block">
          <div className="flex items-center justify-between">
            <span className="text-xs text-side-text">{user.tenant?.name}</span>
            <Badge tone="green" dot>live</Badge>
          </div>
        </div>
      </aside>
      {/* Main — scrolls independently of the sidebar */}
      <div className="flex min-h-0 flex-col lg:h-screen">
        <header className="flex items-center justify-between gap-2.5 border-b border-line bg-surface/80 px-5 py-3 backdrop-blur-md sm:px-8">
          <LiveClock />
          <div className="flex items-center gap-2.5">
            <NotificationBell items={notifications} />
            <UserMenu name={user.name} orgName={user.tenant?.name ?? ""} logoutAction={logoutAction} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,_var(--color-accent-soft),_transparent_45%)] p-5 sm:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
