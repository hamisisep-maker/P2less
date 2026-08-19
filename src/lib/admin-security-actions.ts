"use server";

import { revalidatePath } from "next/cache";
import { db } from "./db";
import { revokeUserSession } from "./auth";
import { assertAdminPermission, logPrivilegedAction, ForbiddenError } from "./admin-authz";

function isForbidden(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

/** Kills one admin session immediately — the "Revoke" button on
 *  /admin/security. Real revocation (see auth.ts's DB-backed UserSession),
 *  not decorative: the next request carrying that session's cookie will be
 *  treated as signed out, mid-session, no matter how long the JWT itself
 *  still claims to be valid for. */
export async function revokeSessionAction(sessionId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("security.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const session = await db.userSession.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session) return { error: "Session not found." };
  if (session.revokedAt) return { ok: true }; // already revoked — nothing to do

  await revokeUserSession(sessionId);
  await logPrivilegedAction({
    admin, permission: "security.manage", action: "admin.session_revoked",
    target: session.user.email, reason,
    detail: { sessionId, ip: session.ip, userAgent: session.userAgent },
  });
  revalidatePath("/admin/security");
  return { ok: true };
}
