"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard, Smartphone, Plug, MessagesSquare, ScrollText, Users,
  HelpCircle, Package, LineChart, MapPinned, Truck, Code2, CreditCard,
  Building2, Wallet, BrainCircuit, Settings, Boxes, ShieldCheck, Lock,
  GitMerge, HeartPulse, AlertTriangle, LifeBuoy, Globe, MessageCircle, ClipboardCheck, type LucideIcon,
} from "lucide-react";
import { NAV, type NavIconName } from "@/lib/nav";

// Icon lookup lives here (client-only) — see nav.ts for why nav data carries
// a string name instead of a component reference.
const ICONS: Record<NavIconName, LucideIcon> = {
  LayoutDashboard, Smartphone, Plug, MessagesSquare, ScrollText, Users,
  HelpCircle, Package, LineChart, MapPinned, Truck, Code2, CreditCard,
  Building2, Wallet, BrainCircuit, Settings, Boxes, ShieldCheck, Lock,
  GitMerge, HeartPulse, AlertTriangle, LifeBuoy, Globe, MessageCircle, ClipboardCheck,
};

type NavItem = { href: string; label: string; icon: NavIconName };

/** Shared sidebar nav — used by both the tenant dashboard and the super-admin
 *  area. `exactRoot` marks the one item (e.g. "/dashboard" or "/admin") that
 *  should only be "active" on an exact match, not for every sub-route.
 *  `collapsed` (set by SidebarShell) hides labels and shows an icon-only
 *  rail with the label as a hover title instead. */
export function SidebarNav({ items = NAV, exactRoot, collapsed = false }: { items?: readonly NavItem[]; exactRoot?: string; collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-row gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const active = href === (exactRoot ?? items[0]?.href) ? pathname === href : pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            className={clsx(
              "group relative flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
              collapsed && "lg:justify-center lg:px-2.5",
              active
                ? "bg-white/[0.08] text-side-text-active"
                : "text-side-text hover:bg-white/[0.05] hover:text-side-text-active",
            )}
          >
            {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[linear-gradient(180deg,var(--color-accent),var(--color-accent-2))]" />}
            <Icon size={17} className={clsx("shrink-0 transition-colors", active ? "text-accent" : "text-side-text/70 group-hover:text-side-text-active")} strokeWidth={2} />
            <span className={clsx(collapsed && "lg:hidden")}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
