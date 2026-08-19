import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { getCurrentUser, type CurrentUser } from "./auth";
import type { AdminPermission } from "./admin-permissions";

// ─────────────────────────────────────────────────────────────────────────────
// The single gate every privileged platform-admin operation must pass through.
// Users → Roles → Permissions → Resources → Actions → Scope → Audit:
//   - Roles/Permissions: user.adminRole.permissions (or the isSuperAdmin
//     bootstrap flag, kept in sync with the super_admin role — see User model).
//   - Scope: user.adminScope — null = every tenant, string[] = only those ids.
//   - Audit: logPrivilegedAction() below, called by every caller that mutates
//     state, never optional for a "dangerous" action.
// Never gate on the frontend alone — every Server Action and API route calls
// assertAdminPermission/requireAdminPermission itself; it does not trust that
// a page already checked.
// ─────────────────────────────────────────────────────────────────────────────

export class ForbiddenError extends Error {
  status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function getClientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    return h.get("x-real-ip");
  } catch {
    return null;
  }
}

/** The admin's effective role key, whether granted via AdminRole or the
 *  legacy isSuperAdmin bootstrap flag (kept in sync — see User model note). */
export function adminRoleKey(user: CurrentUser): string | null {
  if (user.adminRole) return user.adminRole.key;
  if (user.isSuperAdmin) return "super_admin";
  return null;
}

function effectivePermissions(user: CurrentUser): Set<string> {
  if (user.isSuperAdmin) return new Set(["*"]);
  const perms = (user.adminRole?.permissions as string[] | undefined) ?? [];
  return new Set(perms);
}

export function hasAdminPermission(user: CurrentUser | null, permission: AdminPermission): boolean {
  if (!user) return false;
  const perms = effectivePermissions(user);
  if (perms.has("*")) return true;
  if (!perms.has(permission)) return false;
  // roles.manage is a privilege-escalation vector: holding it in ANY role's
  // permission list is not sufficient on its own. Only the actual super_admin
  // role may exercise it, so a misconfigured or compromised custom role can
  // never grant itself (or anyone else) more power than it started with.
  if (permission === "roles.manage" && adminRoleKey(user) !== "super_admin") return false;
  return true;
}

/** true = every tenant (unrestricted); false = tenantId is outside this
 *  admin's assigned scope and must be denied. */
export function isTenantInScope(user: CurrentUser, tenantId: string | null | undefined): boolean {
  if (!tenantId) return true; // action isn't tenant-specific
  if (user.isSuperAdmin) return true;
  const scope = user.adminScope as string[] | null | undefined;
  if (!scope || scope.length === 0) return true; // null/empty = unrestricted
  return scope.includes(tenantId);
}

/** Backend enforcement for Server Actions and API routes. Throws
 *  ForbiddenError (never redirects) so callers get a real, testable 403 —
 *  this is what "unauthorized user calls the API directly" tests against. */
export async function assertAdminPermission(
  permission: AdminPermission,
  opts?: { tenantId?: string | null },
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ForbiddenError("Not authenticated");
  if (!adminRoleKey(user)) throw new ForbiddenError("Not a platform admin");
  if (!hasAdminPermission(user, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
  if (opts?.tenantId !== undefined && !isTenantInScope(user, opts.tenantId)) {
    throw new ForbiddenError("Tenant outside your assigned scope");
  }
  return user;
}

/** Page-level guard (layouts/pages) — redirects instead of throwing, since a
 *  rendered page has nowhere to show a thrown error. Server Actions and API
 *  routes must use assertAdminPermission instead so a denial is a real 403,
 *  not a silent redirect that swallows the distinction between "logged out"
 *  and "logged in but not allowed". */
export async function requireAdminPermission(
  permission: AdminPermission,
  opts?: { tenantId?: string | null },
): Promise<CurrentUser> {
  try {
    return await assertAdminPermission(permission, opts);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      const user = await getCurrentUser();
      redirect(user ? "/dashboard" : "/login");
    }
    throw e;
  }
}

export type LogPrivilegedActionInput = {
  admin: CurrentUser;
  permission: AdminPermission;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown>;
  reason?: string | null;
  /** When set, also writes a tenant-scoped AuditLog entry (visible on that
   *  tenant's own audit page), in addition to the always-written PlatformAuditLog row. */
  tenantId?: string | null;
  previousState?: unknown;
  newState?: unknown;
};

/** Every privileged action's single audit-writing path. Captures the actor,
 *  their role AT THE TIME, the permission that authorized it, the reason
 *  (required by callers for elevated actions), before/after state, and
 *  request metadata — never optional for a mutation gated by
 *  assertAdminPermission. Writing here is the ONLY way a PlatformAuditLog/
 *  AuditLog row is created for admin actions — there is no separate "delete"
 *  path exposed to ordinary admins (see admin-security-actions.ts: audit
 *  rows are never editable/deletable through any action in this codebase). */
export async function logPrivilegedAction(input: LogPrivilegedActionInput): Promise<void> {
  const ip = await getClientIp();
  const role = adminRoleKey(input.admin);
  const detail: Record<string, unknown> = {
    ...input.detail,
    ...(input.previousState !== undefined ? { previousState: input.previousState } : {}),
    ...(input.newState !== undefined ? { newState: input.newState } : {}),
  };

  // Same redaction AuditLog always got — PlatformAuditLog received the exact
  // same detail/previousState/newState payloads (including e.g. credential
  // rotation actions) without ever sanitizing them until this fix.
  const { sanitize } = await import("./audit");
  await db.platformAuditLog.create({
    data: {
      actorId: input.admin.id,
      actorEmail: input.admin.email,
      action: input.action,
      target: input.target ?? null,
      detail: (sanitize(detail) ?? undefined) as Prisma.InputJsonValue | undefined,
      role,
      permission: input.permission,
      reason: input.reason ?? null,
      ip,
    },
  }).catch(() => {});

  if (input.tenantId) {
    const { audit } = await import("./audit");
    const { requestId } = await import("./crypto");
    await audit({
      tenantId: input.tenantId,
      requestId: requestId(),
      actorType: "user",
      actorId: input.admin.id,
      action: input.action,
      target: input.target ?? null,
      success: true,
      detail,
      role,
      permission: input.permission,
      reason: input.reason ?? null,
      ip,
    });
  }
}
