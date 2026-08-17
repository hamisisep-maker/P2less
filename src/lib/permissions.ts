// ─────────────────────────────────────────────────────────────────────────────
// Permission catalog + default roles. RBAC is configurable per tenant, but new
// tenants are seeded with these sensible defaults. A permission is just a string;
// ConnectorAction.requiredPermission references these keys.
// ─────────────────────────────────────────────────────────────────────────────

export const PERMISSIONS = {
  // Dashboard / platform
  TENANT_MANAGE: "tenant.manage",
  USERS_MANAGE: "users.manage",
  CONNECTORS_MANAGE: "connectors.manage",
  CONVERSATIONS_READ: "conversations.read",
  AUDIT_READ: "audit.read",
  BILLING_MANAGE: "billing.manage",
  DEVELOPER_MANAGE: "developer.manage",
  // Conversational capabilities (referenced by ConnectorAction.requiredPermission)
  STUDENT_RESULTS_READ: "student.results.read",
  STUDENT_BALANCE_READ: "student.balance.read",
  STUDENT_ATTENDANCE_READ: "student.attendance.read",
  STUDENT_REPORT_READ: "student.report.read",
  SCHOOL_INFO_READ: "school.info.read",
  APPOINTMENT_READ: "appointment.read",
  APPOINTMENT_BOOK: "appointment.book",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Roles held by dashboard Users (staff of the tenant).
export const DEFAULT_USER_ROLES: {
  key: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}[] = [
  {
    key: "owner",
    name: "Organization Owner",
    isSystem: true,
    permissions: Object.values(PERMISSIONS),
  },
  {
    key: "admin",
    name: "Organization Admin",
    isSystem: true,
    permissions: [
      PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.CONNECTORS_MANAGE,
      PERMISSIONS.CONVERSATIONS_READ,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.DEVELOPER_MANAGE,
    ],
  },
  {
    key: "integration_manager",
    name: "Integration Manager",
    isSystem: true,
    permissions: [PERMISSIONS.CONNECTORS_MANAGE, PERMISSIONS.CONVERSATIONS_READ],
  },
  {
    key: "staff",
    name: "Staff",
    isSystem: true,
    permissions: [PERMISSIONS.CONVERSATIONS_READ],
  },
];

// Roles held by Contacts (conversational end users).
export const DEFAULT_CONTACT_ROLES: {
  key: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}[] = [
  {
    key: "parent",
    name: "Parent / Guardian",
    isSystem: true,
    permissions: [
      PERMISSIONS.STUDENT_RESULTS_READ,
      PERMISSIONS.STUDENT_BALANCE_READ,
      PERMISSIONS.STUDENT_ATTENDANCE_READ,
      PERMISSIONS.STUDENT_REPORT_READ,
      PERMISSIONS.SCHOOL_INFO_READ,
      PERMISSIONS.APPOINTMENT_READ,
      PERMISSIONS.APPOINTMENT_BOOK,
    ],
  },
  {
    key: "end_user",
    name: "End User",
    isSystem: true,
    permissions: [PERMISSIONS.SCHOOL_INFO_READ],
  },
];

export function hasPermission(held: string[], required?: string | null): boolean {
  if (!required) return true;
  return held.includes(required);
}
