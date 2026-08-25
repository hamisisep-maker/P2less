// Plain data — icon identified by STRING name, not a component reference.
// Passing a Lucide component reference itself from a Server Component to a
// Client Component (SidebarNav) is not safe RSC serialization — it happened
// to work in some dev sessions but breaks in others/production ("Functions
// cannot be passed directly to Client Components"). A string key is always
// safe; sidebar-nav.tsx (a client file) owns the actual icon lookup table.
export type NavIconName = "LayoutDashboard" | "Smartphone" | "Plug" | "MessagesSquare" | "ScrollText" | "Users" | "HelpCircle" | "Package" | "LineChart" | "MapPinned" | "Truck" | "Code2" | "CreditCard" | "Building2" | "Wallet" | "BrainCircuit" | "Settings" | "Boxes" | "ShieldCheck" | "Lock" | "GitMerge" | "HeartPulse" | "AlertTriangle" | "LifeBuoy" | "Globe" | "MessageCircle" | "ClipboardCheck" | "Compass";

// Registration reframe Track B (roadmap doc "Registration reframe" section)
// — capability-based dynamic navigation. Most items are universal ("shared
// core" every tenant needs regardless of what they do); a few are only
// relevant to a subset of tenants and carry a `group` tag so the dashboard
// layout can hide them for tenants with no signal they're relevant.
export type NavGroup = "commerce" | "integrations" | "developer" | "widget";

export const NAV: { href: string; label: string; icon: NavIconName; group?: NavGroup }[] = [
  { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
  // Phase 2 "Explore" hub, 2026-08-25 — always visible (no `group`), so a
  // tenant can revisit it any time after their first pass, per the agreed
  // "one-time on first login, revisitable later via a persistent nav link".
  { href: "/explore", label: "Explore P2Less", icon: "Compass" },
  { href: "/dashboard/channels", label: "Channels", icon: "Smartphone" },
  { href: "/dashboard/connectors", label: "Integrations", icon: "Plug", group: "integrations" },
  { href: "/dashboard/conversations", label: "Conversations", icon: "MessagesSquare" },
  { href: "/dashboard/audit", label: "Audit log", icon: "ScrollText" },
  { href: "/dashboard/users", label: "Users & roles", icon: "Users" },
  { href: "/dashboard/faqs", label: "Assistant FAQs", icon: "HelpCircle" },
  { href: "/dashboard/products", label: "Products", icon: "Package", group: "commerce" },
  { href: "/dashboard/sales", label: "Sales", icon: "LineChart", group: "commerce" },
  { href: "/dashboard/delivery", label: "Delivery Zones", icon: "MapPinned", group: "commerce" },
  { href: "/dashboard/drivers", label: "Drivers", icon: "Truck", group: "commerce" },
  { href: "/dashboard/developers", label: "Developers", icon: "Code2", group: "developer" },
  { href: "/dashboard/widget", label: "Website Widget", icon: "Globe", group: "widget" },
  { href: "/dashboard/billing", label: "Billing", icon: "CreditCard" },
  { href: "/dashboard/settings", label: "Settings", icon: "Settings" },
];

/** What a tenant told us at signup (self-report) plus what's actually real
 *  in their data (capability signal) — either one is enough to show a
 *  group's nav items. Self-report alone covers a brand-new tenant with zero
 *  data yet (a developer who just signed up needs to SEE "Developers" to go
 *  create their first API key); data alone covers a tenant whose usage has
 *  evolved past what they originally said, or who predates these signup
 *  questions entirely (every pre-existing tenant has null useCases/
 *  channelsNeeded, so its nav is derived purely from real data — no backfill
 *  script needed, and it's still an honest reflection of what they use). */
export type NavCapabilities = {
  useCases: string[];
  channelsNeeded: string[];
  hasConnectors: boolean;
  hasApiActivity: boolean;
  hasProducts: boolean;
  hasWidgetKey: boolean;
};

const GROUP_VISIBLE: Record<NavGroup, (c: NavCapabilities) => boolean> = {
  commerce: (c) => c.useCases.includes("sell_products") || c.hasProducts,
  integrations: (c) => c.useCases.includes("connect_systems") || c.hasConnectors,
  developer: (c) => c.useCases.includes("developer_api") || c.hasApiActivity,
  widget: (c) => c.channelsNeeded.includes("web_chat") || c.hasWidgetKey,
};

/** Pure decision function — same "classify now, caller resolves async facts
 *  first" discipline as evaluateCapabilityGate() (Phase 3). No DB access
 *  here; the dashboard layout resolves the real counts and passes them in. */
export function resolveVisibleNav(caps: NavCapabilities) {
  return NAV.filter((item) => !item.group || GROUP_VISIBLE[item.group](caps));
}
