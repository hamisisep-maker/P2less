// ─────────────────────────────────────────────────────────────────────────────
// The canonical list of platform-admin permissions. Every privileged admin
// action (see admin-actions.ts / billing-lifecycle.ts) is gated by one of
// these via requireAdminPermission() in admin-authz.ts — never a bare
// `if (user.isSuperAdmin)` check scattered through the code.
//
// This is a plain code-defined array, not a DB table: permissions are
// CAPABILITIES the codebase understands, not data an admin invents. Roles
// (which ARE data, stored in AdminRole) reference these keys.
// ─────────────────────────────────────────────────────────────────────────────

export const ADMIN_PERMISSIONS = [
  "tenants.view",
  "tenants.suspend",
  "tenants.reactivate",
  "tenants.cancel", // permanently cancel a subscription (self-service was deliberately rejected — see admin-actions.ts's cancelTenantSubscriptionAction) — kept separate from suspend/reactivate: those are reversible access toggles, this ends the subscription and settles a final bill
  "tenants.change_plan", // assign a tenant to a different plan (upgrade or downgrade) — distinct from plans.edit, which edits the GLOBAL plan definition, not which plan a specific tenant is on. Tenants can self-service upgrade themselves via the invoice-centric paid-upgrade flow (see invoicing.ts's createUpgradeInvoiceAction, gated by billing.manage instead); this permission covers admin-initiated changes either direction, including downgrades (deliberately not self-service — see changeTenantPlanAction)
  "billing.view",
  "billing.confirm_payment",
  "billing.refund",
  "billing.manage_pricing",
  "billing.manage_automation",
  "plans.view",
  "plans.edit",
  "models.view",
  "models.change_primary",
  "models.edit_pricing",
  "providers.view",
  "providers.manage",
  "audit.view",
  "security.manage",
  "settings.manage",
  // The most dangerous permission — controls who can grant/revoke every
  // other permission. See admin-authz.ts: holding this in a role is not
  // enough on its own to exercise it; an extra super_admin-only check
  // guards it specifically, so a compromised custom role can never grant
  // itself the ability to grant itself more power.
  "roles.manage",

  // ── Priority 4: operational nervous system ──────────────────────────────
  "integrations.view",
  "integrations.manage", // enable/disable, non-secret config
  "integrations.manage_credentials", // replace/rotate/test-connection — SECRETS, kept separate from integrations.manage
  "system_health.view",
  "incidents.view",
  "incidents.manage", // acknowledge / investigate / resolve
  "reconciliation.view",
  "reconciliation.match", // manual UnmatchedTransaction match + Payment-level "unknown" resolution — financial
  "webhooks.view", // inbound event/webhook investigation
  "maintenance.manage", // platform-wide maintenance mode — highest blast radius; also requires typed confirmation in the action itself

  // ── Priority 5: Customer Operations Centre (support tickets) ────────────
  "tickets.view",
  "tickets.manage", // create/edit/assign/status-transition/link to payment or incident
  "tickets.internal_notes", // write internal-only TicketEvent rows — kept separate from tickets.manage so a future customer-facing role could respond to customers without seeing internal investigation notes
  "tickets.resolve", // close with a required resolution + resolutionReason — kept distinct from tickets.manage, same reasoning as incidents.manage's separate acknowledge/investigate/resolve gate

  // ── Priority 6: Notification Engine ──────────────────────────────────────
  "notifications.view",
  "notifications.manage", // create/edit/enable/disable NotificationRule rows — was billing.manage_automation-only before this generalized beyond billing events

  // ── Priority 7: Product Intelligence (Phase 4 of the onboarding-restructure initiative) ──
  "product_intelligence.view", // aggregate/cross-tab/history view of tenants' self-reported useCases/channelsNeeded interest — read-only, no tenant-level mutation capability
] as const;

export type AdminPermission = typeof ADMIN_PERMISSIONS[number];

export const PERMISSION_LABELS: Record<AdminPermission, string> = {
  "tenants.view": "View tenants",
  "tenants.suspend": "Suspend tenants",
  "tenants.reactivate": "Reactivate tenants",
  "tenants.cancel": "Cancel a tenant's subscription (permanent, stops the assistant immediately)",
  "tenants.change_plan": "Change which plan a tenant is assigned to (upgrade or downgrade)",
  "billing.view": "View billing & revenue",
  "billing.confirm_payment": "Manually confirm/resolve payments",
  "billing.refund": "Issue refunds",
  "billing.manage_pricing": "Edit platform pricing (what tenants are charged)",
  "billing.manage_automation": "Configure billing automation (grace periods, retries, notification rules)",
  "plans.view": "View subscription plans",
  "plans.edit": "Edit subscription plans",
  "models.view": "View AI models & usage",
  "models.change_primary": "Change the primary AI model",
  "models.edit_pricing": "Edit AI model/provider cost pricing",
  "providers.view": "View AI provider status",
  "providers.manage": "Manage AI provider configuration",
  "audit.view": "View audit logs",
  "security.manage": "Manage security (sessions, access)",
  "settings.manage": "Manage own admin profile/settings",
  "roles.manage": "Create/edit admin roles and assign them to users",

  "integrations.view": "View integration status and configuration",
  "integrations.manage": "Enable/disable integrations and edit non-secret configuration",
  "integrations.manage_credentials": "Replace, rotate, and test integration credentials",
  "system_health.view": "View system health and background job status",
  "incidents.view": "View incidents",
  "incidents.manage": "Acknowledge, investigate, and resolve incidents",
  "reconciliation.view": "View payment reconciliation and unmatched transactions",
  "reconciliation.match": "Manually match unmatched transactions and resolve unknown payments",
  "webhooks.view": "Investigate inbound webhook/callback events",
  "maintenance.manage": "Enable or disable platform maintenance mode",

  "tickets.view": "View support tickets",
  "tickets.manage": "Create, assign, and update support tickets",
  "tickets.internal_notes": "Write internal (non-customer-visible) ticket notes",
  "tickets.resolve": "Resolve support tickets with a recorded reason",

  "notifications.view": "View notification rules and delivery status",
  "notifications.manage": "Create, edit, and enable/disable notification rules",

  "product_intelligence.view": "View aggregate product-interest analytics (use-case/channel counts, cross-tabs, history)",
};

export type BuiltInRoleKey = "super_admin" | "finance_admin" | "operations_admin" | "support_admin" | "security_admin" | "read_only_admin";

export const BUILT_IN_ROLES: Record<BuiltInRoleKey, { name: string; permissions: AdminPermission[] }> = {
  super_admin: {
    name: "Super Admin",
    permissions: [...ADMIN_PERMISSIONS],
  },
  finance_admin: {
    name: "Finance Admin",
    permissions: [
      "billing.view", "billing.confirm_payment", "billing.refund", "billing.manage_pricing", "billing.manage_automation",
      "plans.view", "plans.edit", "tenants.view", "tenants.change_plan", "audit.view",
      "integrations.view", "reconciliation.view", "reconciliation.match", "tickets.view", "notifications.view", "notifications.manage",
    ],
  },
  operations_admin: {
    name: "Operations Admin",
    permissions: [
      "tenants.view", "tenants.suspend", "tenants.reactivate", "tenants.cancel", "tenants.change_plan",
      "models.view", "models.change_primary", "models.edit_pricing",
      "providers.view", "providers.manage", "audit.view",
      "integrations.view", "integrations.manage", "system_health.view", "incidents.view", "incidents.manage", "webhooks.view",
      "tickets.view", "tickets.manage", "notifications.view", "notifications.manage", "product_intelligence.view",
    ],
  },
  support_admin: {
    name: "Support Admin",
    permissions: [
      "tenants.view", "tenants.suspend", "tenants.reactivate", "billing.view", "audit.view",
      "system_health.view", "incidents.view", "webhooks.view",
      "tickets.view", "tickets.manage", "tickets.internal_notes", "tickets.resolve", "notifications.view",
    ],
  },
  security_admin: {
    name: "Security Admin",
    permissions: ["audit.view", "security.manage", "integrations.manage_credentials", "maintenance.manage", "tickets.view", "notifications.view"],
  },
  read_only_admin: {
    name: "Read Only / Auditor",
    permissions: [
      "tenants.view", "billing.view", "plans.view", "models.view", "providers.view", "audit.view",
      "integrations.view", "system_health.view", "incidents.view", "reconciliation.view", "webhooks.view", "tickets.view", "notifications.view",
      "product_intelligence.view",
    ],
  },
};
