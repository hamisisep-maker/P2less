// Plain data — icon identified by STRING name, not a component reference.
// Passing a Lucide component reference itself from a Server Component to a
// Client Component (SidebarNav) is not safe RSC serialization — it happened
// to work in some dev sessions but breaks in others/production ("Functions
// cannot be passed directly to Client Components"). A string key is always
// safe; sidebar-nav.tsx (a client file) owns the actual icon lookup table.
export type NavIconName = "LayoutDashboard" | "Smartphone" | "Plug" | "MessagesSquare" | "ScrollText" | "Users" | "HelpCircle" | "Package" | "LineChart" | "MapPinned" | "Truck" | "Code2" | "CreditCard" | "Building2" | "Wallet" | "BrainCircuit" | "Settings" | "Boxes" | "ShieldCheck" | "Lock";

export const NAV: { href: string; label: string; icon: NavIconName }[] = [
  { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
  { href: "/dashboard/numbers", label: "WhatsApp Numbers", icon: "Smartphone" },
  { href: "/dashboard/connectors", label: "Integrations", icon: "Plug" },
  { href: "/dashboard/conversations", label: "Conversations", icon: "MessagesSquare" },
  { href: "/dashboard/audit", label: "Audit log", icon: "ScrollText" },
  { href: "/dashboard/users", label: "Users & roles", icon: "Users" },
  { href: "/dashboard/faqs", label: "Assistant FAQs", icon: "HelpCircle" },
  { href: "/dashboard/products", label: "Products", icon: "Package" },
  { href: "/dashboard/sales", label: "Sales", icon: "LineChart" },
  { href: "/dashboard/delivery", label: "Delivery Zones", icon: "MapPinned" },
  { href: "/dashboard/drivers", label: "Drivers", icon: "Truck" },
  { href: "/dashboard/developers", label: "Developers", icon: "Code2" },
  { href: "/dashboard/billing", label: "Billing", icon: "CreditCard" },
];
