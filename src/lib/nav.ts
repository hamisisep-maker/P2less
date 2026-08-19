// Plain data, no server-only imports — safe to import from both the (server)
// dashboard layout and the (client) sidebar nav component.
export const NAV = [
  ["/dashboard", "Overview"],
  ["/dashboard/numbers", "WhatsApp Numbers"],
  ["/dashboard/connectors", "Integrations"],
  ["/dashboard/conversations", "Conversations"],
  ["/dashboard/audit", "Audit log"],
  ["/dashboard/users", "Users & roles"],
  ["/dashboard/faqs", "Assistant FAQs"],
  ["/dashboard/products", "Products"],
  ["/dashboard/sales", "Sales"],
  ["/dashboard/delivery", "Delivery Zones"],
  ["/dashboard/drivers", "Drivers"],
  ["/dashboard/developers", "Developers"],
  ["/dashboard/billing", "Billing"],
] as const;
