// Plain data — see nav.ts for why icons are string names, not component refs.
import type { NavIconName } from "./nav";

export const ADMIN_NAV: { href: string; label: string; icon: NavIconName }[] = [
  { href: "/admin", label: "Overview", icon: "LayoutDashboard" },
  { href: "/admin/tenants", label: "Tenants", icon: "Building2" },
  { href: "/admin/conversations", label: "Conversations", icon: "MessagesSquare" },
  { href: "/admin/billing", label: "Billing & Revenue", icon: "Wallet" },
  { href: "/admin/ai", label: "AI Providers", icon: "BrainCircuit" },
  { href: "/admin/models", label: "Models", icon: "Boxes" },
  { href: "/admin/system-health", label: "System Health", icon: "HeartPulse" },
  { href: "/admin/integrations", label: "Integrations", icon: "Plug" },
  { href: "/admin/reconciliation", label: "Reconciliation", icon: "GitMerge" },
  { href: "/admin/incidents", label: "Incidents", icon: "AlertTriangle" },
  { href: "/admin/tickets", label: "Support Tickets", icon: "LifeBuoy" },
  { href: "/admin/quality", label: "Quality Centre", icon: "ClipboardCheck" },
  { href: "/admin/roles", label: "Roles & Access", icon: "ShieldCheck" },
  { href: "/admin/security", label: "Security", icon: "Lock" },
  { href: "/admin/settings", label: "Settings", icon: "Settings" },
];
