import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { enterTenantContext, enterCrossTenantContext } from "./tenant-context";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "p2less-dev-secret");
const COOKIE = "p2less_session";
const SESSION_DAYS = 30;

// sid = the DB-backed UserSession row this JWT corresponds to. The JWT alone
// is stateless and unrevokable; sid is what lets an admin's session actually
// be killed from /admin/security (see revokeUserSession below) instead of
// that button being decorative.
export type SessionPayload = { uid: string; tid: string | null; sa: boolean; sid: string };

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function clientMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    return { ip: fwd ? fwd.split(",")[0]!.trim() : h.get("x-real-ip"), userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function recordLoginAttempt(email: string, success: boolean) {
  const { ip, userAgent } = await clientMeta();
  await db.loginAttempt.create({ data: { email: email.toLowerCase().trim(), success, ip, userAgent } }).catch(() => {});
}

export async function createSession(userId: string, tenantId: string | null, superAdmin: boolean) {
  const { ip, userAgent } = await clientMeta();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const session = await db.userSession.create({ data: { userId, ip, userAgent, expiresAt } });

  const token = await new SignJWT({ uid: userId, tid: tenantId, sa: superAdmin, sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

export async function destroySession() {
  const token = (await cookies()).get(COOKIE)?.value;
  (await cookies()).delete(COOKIE);
  if (!token) return;
  try {
    const { payload } = await jwtVerify(token, secret);
    const sid = (payload as unknown as SessionPayload).sid;
    if (sid) await db.userSession.update({ where: { id: sid }, data: { revokedAt: new Date() } }).catch(() => {});
  } catch {
    // token already invalid — nothing to revoke
  }
}

/** Kills one session by id regardless of who's currently logged in as it —
 *  this is what the admin security centre's "Revoke" button calls. */
export async function revokeUserSession(sessionId: string) {
  await db.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

const ACTIVITY_TOUCH_INTERVAL_MS = 60_000;

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let payload: SessionPayload;
  try {
    const result = await jwtVerify(token, secret);
    payload = result.payload as unknown as SessionPayload;
  } catch {
    return null;
  }
  if (!payload.sid) return null; // pre-migration token with no DB-backed session — treat as signed out

  const dbSession = await db.userSession.findUnique({ where: { id: payload.sid } });
  if (!dbSession || dbSession.revokedAt || dbSession.expiresAt < new Date()) return null;

  if (Date.now() - dbSession.lastActiveAt.getTime() > ACTIVITY_TOUCH_INTERVAL_MS) {
    await db.userSession.update({ where: { id: payload.sid }, data: { lastActiveAt: new Date() } }).catch(() => {});
  }

  return payload;
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.uid },
    include: { tenant: true, userRoles: { include: { role: true } }, adminRole: true },
  });
  // A deactivated staff/admin account is treated as logged out on their very
  // next request — no separate session-table revocation needed, since this
  // check runs on every request that resolves a user.
  if (user?.deactivatedAt) return null;
  return user;
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Require a tenant-scoped user (dashboard). Super admins are redirected to /admin. */
export async function requireTenantUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.tenantId) redirect("/admin");
  // Tenant-isolation hardening — every dashboard page/server action that
  // calls this now runs with the tenant-scoping Prisma extension (db.ts)
  // active, so a query that forgets `where: { tenantId }` comes back
  // correctly scoped anyway instead of leaking cross-tenant.
  enterTenantContext(user.tenantId);
  return user;
}

/** Legacy coarse gate — still used by the admin layout to keep any platform
 *  admin (any role) into /admin at all. Individual pages/actions must still
 *  call requireAdminPermission/assertAdminPermission (admin-authz.ts) for the
 *  SPECIFIC permission they need; being "some kind of admin" is not itself a
 *  permission. */
export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isSuperAdmin && !user.adminRoleId) redirect("/dashboard");
  // Tenant-isolation fail-open audit, 2026-08-23 — every /admin/** page
  // renders through this (the admin layout's own gate), so this is the
  // single choke point that marks the whole page tree as deliberately
  // cross-tenant for db.ts's extension. See tenant-context.ts's comment.
  enterCrossTenantContext();
  return user;
}

export function userPermissions(user: CurrentUser): string[] {
  return user.userRoles.flatMap((ur) => (ur.role.permissions as string[]) ?? []);
}
