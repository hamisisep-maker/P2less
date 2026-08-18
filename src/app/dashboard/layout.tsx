import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { Logo } from "@/components/ui";

const NAV = [
  ["/dashboard", "Overview"],
  ["/dashboard/numbers", "WhatsApp Numbers"],
  ["/dashboard/connectors", "Integrations"],
  ["/dashboard/conversations", "Conversations"],
  ["/dashboard/audit", "Audit log"],
  ["/dashboard/users", "Users & roles"],
  ["/dashboard/faqs", "Assistant FAQs"],
  ["/dashboard/products", "Products"],
  ["/dashboard/delivery", "Delivery Zones"],
  ["/dashboard/drivers", "Drivers"],
  ["/dashboard/developers", "Developers"],
  ["/dashboard/billing", "Billing"],
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireTenantUser();
  return (
    <div className="min-h-screen lg:grid lg:h-screen lg:grid-cols-[248px_1fr] lg:overflow-hidden">
      {/* Sidebar — scrolls on its own on desktop */}
      <aside className="flex flex-col border-b border-line bg-surface lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="p-5"><Logo /></div>
        <nav className="flex flex-row gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink">
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-line p-4 lg:block">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="text-xs text-muted">{user.tenant?.name}</div>
          <form action={logoutAction} className="mt-2">
            <button className="text-xs text-rose hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      {/* Main — scrolls independently of the sidebar */}
      <main className="p-5 sm:p-8 lg:h-screen lg:overflow-y-auto">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
