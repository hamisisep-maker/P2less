// Plain data — see nav.ts for why icons are string names, not component refs.
import type { NavIconName } from "./nav";

export const ADMIN_NAV: { href: string; label: string; icon: NavIconName }[] = [
  { href: "/admin", label: "Overview", icon: "LayoutDashboard" },
  { href: "/admin/tenants", label: "Tenants", icon: "Building2" },
  { href: "/admin/billing", label: "Billing & Revenue", icon: "Wallet" },
  { href: "/admin/ai", label: "AI Providers", icon: "BrainCircuit" },
  { href: "/admin/settings", label: "Settings", icon: "Settings" },
];
