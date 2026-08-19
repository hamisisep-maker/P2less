import { requireSuperAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { Logo, Badge } from "@/components/ui";
import { UserMenu, LiveClock } from "@/components/dashboard-ui";
import { SidebarNav } from "@/components/sidebar-nav";
import { ADMIN_NAV } from "@/lib/admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();

  return (
    <div className="min-h-screen lg:grid lg:h-screen lg:grid-cols-[260px_1fr] lg:overflow-hidden">
      <aside className="flex flex-col border-b border-side-line bg-side-bg lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="p-5"><Logo dark /></div>
        <SidebarNav items={ADMIN_NAV} exactRoot="/admin" />
        <div className="mt-auto hidden border-t border-side-line p-4 lg:block">
          <div className="flex items-center justify-between">
            <span className="text-xs text-side-text">Super Admin</span>
            <Badge tone="green" dot>live</Badge>
          </div>
        </div>
      </aside>
      <div className="flex min-h-0 flex-col lg:h-screen">
        <header className="flex items-center justify-between gap-2.5 border-b border-line bg-surface/80 px-5 py-3 backdrop-blur-md sm:px-8">
          <LiveClock />
          <UserMenu name={user.name} orgName="Super Admin" logoutAction={logoutAction} />
        </header>
        <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,_var(--color-accent-soft),_transparent_45%)] p-5 sm:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
