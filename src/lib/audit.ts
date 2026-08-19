import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";

export type AuditInput = {
  tenantId: string;
  requestId: string;
  actorType: "contact" | "user" | "system";
  actorId?: string | null;
  action: string;
  target?: string | null;
  success: boolean;
  detail?: Record<string, unknown>;
  // RBAC context — populated when a platform admin performed this via
  // requireAdminPermission/logPrivilegedAction (admin-authz.ts).
  role?: string | null;
  permission?: string | null;
  reason?: string | null;
  ip?: string | null;
};

// Keys that must never land in the audit trail even if a caller passes them.
const REDACT = /(password|secret|token|apikey|api_key|authorization|pin|otp|code)/i;

function sanitize(detail?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (REDACT.test(k)) {
      out[k] = "[redacted]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = v.slice(0, 500) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        tenantId: input.tenantId,
        requestId: input.requestId,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        target: input.target ?? null,
        success: input.success,
        detail: (sanitize(input.detail) ?? undefined) as Prisma.InputJsonValue | undefined,
        role: input.role ?? null,
        permission: input.permission ?? null,
        reason: input.reason ?? null,
        ip: input.ip ?? null,
      },
    });
  } catch {
    // Auditing must never break the request path; failures are swallowed but
    // would surface in observability in production.
  }
}
