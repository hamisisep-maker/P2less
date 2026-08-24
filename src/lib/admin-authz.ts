import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { getCurrentUser, requireSuperAdmin, type CurrentUser } from "./auth";
import { enterCrossTenantContext } from "./tenant-context";
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
  // Tenant-isolation fail-open audit, 2026-08-23 — the real choke point for
  // every admin SERVER ACTION (requireAdminPermission, the page-level
  // variant, calls this too). See tenant-context.ts's comment.
  enterCrossTenantContext();
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

// ─────────────────────────────────────────────────────────────────────────────
// Tenant-isolation hardening, 2026-08-23/24 root-cause fix — these two
// wrappers exist because assertAdminPermission()/requireAdminPermission()
// calling enterCrossTenantContext() INSIDE themselves and then RETURNING a
// value for the caller to keep using does not reliably survive under a real
// `next build && next start` (proved by direct isolated reproduction — see
// tenant-context.ts's comment): the AsyncLocalStorage context set inside a
// nested async function is lost the instant that function returns to its
// caller, even one line later in the exact same function body. What DOES
// reliably survive: set context, then IMMEDIATELY (no return-and-resume
// step) invoke a callback synchronously — even across further awaits inside
// that callback, even a callback defined in another module, even reading it
// from db.ts's own Prisma extension.
//
// So instead of "call a guard, get a value back, keep using it", every
// admin entry point that does tenant/cross-tenant db.ts work after its
// guard must use the "guard-and-invoke" shape below: call one of these with
// the REMAINING logic as a callback (`fn`). Context is (re-)entered here,
// synchronously, in this function's own frame, with fn() invoked immediately
// after — never awaited-then-resumed-into on the caller's side first.
// ─────────────────────────────────────────────────────────────────────────────

/** For PAGES/LAYOUTS. Same behavior as requireAdminPermission (redirects to
 *  /dashboard or /login on denial) but invokes fn(user) synchronously after
 *  (re-)setting cross-tenant context, instead of returning a value for the
 *  page component to keep using across its own await boundaries. */
export async function withAdminPermission<T>(
  permission: AdminPermission,
  fn: (user: CurrentUser) => T | Promise<T>,
  opts?: { tenantId?: string | null },
): Promise<T> {
  const user = await requireAdminPermission(permission, opts);
  enterCrossTenantContext();
  return fn(user);
}

/** For SERVER ACTIONS. Never redirects — returns { error: string } on denial
 *  instead, matching the hand-rolled try/catch-ForbiddenError pattern used
 *  everywhere else. Invokes fn(admin) synchronously after (re-)setting
 *  cross-tenant context. */
export async function withAssertAdminPermission<T>(
  permission: AdminPermission,
  fn: (user: CurrentUser) => Promise<T>,
  opts?: { tenantId?: string | null },
): Promise<T | { error: string }> {
  let user: CurrentUser;
  try {
    user = await assertAdminPermission(permission, opts);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  enterCrossTenantContext();
  return fn(user);
}

/** For the small number of admin pages/actions that aren't gated by a
 *  specific AdminPermission — just "is a logged-in platform admin at all"
 *  (the /admin overview page, self-service password change). Same
 *  guard-and-invoke shape as withAdminPermission, built on requireSuperAdmin
 *  (auth.ts) instead of a permission check. */
export async function withAnyAdmin<T>(fn: (user: CurrentUser) => T | Promise<T>): Promise<T> {
  const user = await requireSuperAdmin();
  enterCrossTenantContext();
  return fn(user);
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
  const { CHAIN_GENESIS, chainHash } = await import("./audit-chain");
  const sanitizedDetail = sanitize(detail);
  const createdAt = new Date();
  // Hash-chain (2026-08-23/24 security review) — same reasoning and
  // transaction-based race-safety as AuditLog's chain (audit.ts), ONE global
  // chain here since PlatformAuditLog isn't tenant-scoped.
  await db.$transaction(async (tx) => {
    const last = await tx.platformAuditLog.findFirst({ orderBy: { createdAt: "desc" } });
    const prevHash = last?.hash ?? CHAIN_GENESIS;
    const hash = chainHash(prevHash, {
      actorId: input.admin.id,
      actorEmail: input.admin.email,
      action: input.action,
      target: input.target ?? null,
      detail: sanitizedDetail,
      role: role ?? null,
      permission: input.permission,
      reason: input.reason ?? null,
      ip,
      createdAtIso: createdAt.toISOString(),
    });
    await tx.platformAuditLog.create({
      data: {
        actorId: input.admin.id,
        actorEmail: input.admin.email,
        action: input.action,
        target: input.target ?? null,
        detail: (sanitizedDetail ?? undefined) as Prisma.InputJsonValue | undefined,
        role,
        permission: input.permission,
        reason: input.reason ?? null,
        ip,
        createdAt,
        prevHash,
        hash,
      },
    });
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

/** Walks the single global PlatformAuditLog chain, recomputing each row's
 *  hash and confirming it matches both the stored value and the previous
 *  row's hash — same shape as verifyAuditChain (audit.ts), see its comment.
 *  Read-only. */
export async function verifyPlatformAuditChain(): Promise<{ ok: boolean; checked: number; brokenAt?: { id: string; createdAt: Date } }> {
  const { CHAIN_GENESIS, chainHash } = await import("./audit-chain");
  const rows = await db.platformAuditLog.findMany({ where: { hash: { not: null } }, orderBy: { createdAt: "asc" } });
  let expectedPrev = rows[0]?.prevHash ?? CHAIN_GENESIS;
  let checked = 0;
  for (const row of rows) {
    const recomputed = chainHash(row.prevHash ?? CHAIN_GENESIS, {
      actorId: row.actorId,
      actorEmail: row.actorEmail,
      action: row.action,
      target: row.target,
      detail: row.detail,
      role: row.role,
      permission: row.permission,
      reason: row.reason,
      ip: row.ip,
      createdAtIso: row.createdAt.toISOString(),
    });
    if (row.prevHash !== expectedPrev || recomputed !== row.hash) {
      return { ok: false, checked, brokenAt: { id: row.id, createdAt: row.createdAt } };
    }
    expectedPrev = row.hash!;
    checked++;
  }
  return { ok: true, checked };
}
