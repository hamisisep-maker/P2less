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
] as const;

export type AdminPermission = typeof ADMIN_PERMISSIONS[number];

export const PERMISSION_LABELS: Record<AdminPermission, string> = {
  "tenants.view": "View tenants",
  "tenants.suspend": "Suspend tenants",
  "tenants.reactivate": "Reactivate tenants",
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
      "plans.view", "plans.edit", "audit.view",
    ],
  },
  operations_admin: {
    name: "Operations Admin",
    permissions: [
      "tenants.view", "tenants.suspend", "tenants.reactivate",
      "models.view", "models.change_primary", "models.edit_pricing",
      "providers.view", "providers.manage", "audit.view",
    ],
  },
  support_admin: {
    name: "Support Admin",
    permissions: ["tenants.view", "tenants.suspend", "tenants.reactivate", "billing.view", "audit.view"],
  },
  security_admin: {
    name: "Security Admin",
    permissions: ["audit.view", "security.manage"],
  },
  read_only_admin: {
    name: "Read Only / Auditor",
    permissions: ["tenants.view", "billing.view", "plans.view", "models.view", "providers.view", "audit.view"],
  },
};
