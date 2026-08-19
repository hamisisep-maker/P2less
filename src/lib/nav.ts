// Plain data (icon COMPONENT REFERENCES, not JSX — this file stays a .ts
// module with no rendering, so it's safe to import from both the server
// dashboard layout and the client sidebar nav without pulling in anything
// server-only).
import {
  LayoutDashboard, Smartphone, Plug, MessagesSquare, ScrollText, Users,
  HelpCircle, Package, LineChart, MapPinned, Truck, Code2, CreditCard,
  type LucideIcon,
} from "lucide-react";

export const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/numbers", label: "WhatsApp Numbers", icon: Smartphone },
  { href: "/dashboard/connectors", label: "Integrations", icon: Plug },
  { href: "/dashboard/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/dashboard/audit", label: "Audit log", icon: ScrollText },
  { href: "/dashboard/users", label: "Users & roles", icon: Users },
  { href: "/dashboard/faqs", label: "Assistant FAQs", icon: HelpCircle },
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/sales", label: "Sales", icon: LineChart },
  { href: "/dashboard/delivery", label: "Delivery Zones", icon: MapPinned },
  { href: "/dashboard/drivers", label: "Drivers", icon: Truck },
  { href: "/dashboard/developers", label: "Developers", icon: Code2 },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];
