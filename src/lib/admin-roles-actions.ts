"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { assertAdminPermission, logPrivilegedAction, ForbiddenError } from "./admin-authz";
import { ADMIN_PERMISSIONS } from "./admin-permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Role & admin-assignment management. Every action here is gated on
// "roles.manage" — and roles.manage is itself hard-restricted to the actual
// super_admin role in admin-authz.ts's hasAdminPermission(), not just
// whatever a role's permission list happens to contain. That's the structural
// reason none of the safeguards below can be bypassed by a crafted custom
// role: only a real super admin can ever reach these functions at all.
// ─────────────────────────────────────────────────────────────────────────────

function isForbidden(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const roleSchema = z.object({
  name: z.string().min(2, "Name is required."),
  permissions: z.array(z.string()).min(1, "Select at least one permission."),
  reason: z.string().min(1, "A reason is required."),
});

function parsePermissions(formData: FormData): string[] {
  return formData.getAll("permissions").map(String);
}

export async function createAdminRoleAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("roles.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    permissions: parsePermissions(formData),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const invalid = parsed.data.permissions.filter((p) => !(ADMIN_PERMISSIONS as readonly string[]).includes(p));
  if (invalid.length) return { error: `Unknown permission(s): ${invalid.join(", ")}` };

  const key = `custom_${slugify(parsed.data.name)}`;
  const existing = await db.adminRole.findUnique({ where: { key } });
  if (existing) return { error: "A role with a very similar name already exists." };

  const role = await db.adminRole.create({
    data: { key, name: parsed.data.name, permissions: parsed.data.permissions, isBuiltIn: false },
  });
  await logPrivilegedAction({
    admin, permission: "roles.manage", action: "admin.role_create", target: role.name, reason: parsed.data.reason,
    newState: { key: role.key, permissions: parsed.data.permissions },
    detail: parsed.data.permissions.includes("roles.manage")
      ? { warning: "This role includes roles.manage, but the hard-coded check in admin-authz.ts still restricts actually exercising it to the super_admin role key." }
      : undefined,
  });
  revalidatePath("/admin/roles");
  return { ok: true };
}

const updateRoleSchema = roleSchema.extend({ roleId: z.string().min(1) });

export async function updateAdminRoleAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("roles.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const parsed = updateRoleSchema.safeParse({
    roleId: formData.get("roleId"),
    name: formData.get("name"),
    permissions: parsePermissions(formData),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const invalid = parsed.data.permissions.filter((p) => !(ADMIN_PERMISSIONS as readonly string[]).includes(p));
  if (invalid.length) return { error: `Unknown permission(s): ${invalid.join(", ")}` };

  const role = await db.adminRole.findUnique({ where: { id: parsed.data.roleId } });
  if (!role) return { error: "Role not found." };
  // The super_admin role is the anchor the whole permission system hangs
  // off — accidentally stripping roles.manage (or anything else) from it
  // would be a self-inflicted lockout with no recovery path short of a DB
  // edit. It is never editable through this UI, built-in or not.
  if (role.key === "super_admin") return { error: "The Super Admin role's permissions are fixed and cannot be edited." };

  const before = role.permissions;
  const updated = await db.adminRole.update({
    where: { id: role.id },
    data: { name: parsed.data.name, permissions: parsed.data.permissions },
  });
  await logPrivilegedAction({
    admin, permission: "roles.manage", action: "admin.role_update", target: updated.name, reason: parsed.data.reason,
    previousState: { permissions: before }, newState: { permissions: parsed.data.permissions },
  });
  revalidatePath("/admin/roles");
  return { ok: true };
}

export async function deleteAdminRoleAction(roleId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("roles.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const role = await db.adminRole.findUnique({ where: { id: roleId } });
  if (!role) return { error: "Role not found." };
  if (role.isBuiltIn) return { error: `"${role.name}" is a built-in role and cannot be deleted.` };
  const assignedCount = await db.user.count({ where: { adminRoleId: roleId } });
  if (assignedCount > 0) {
    return { error: `"${role.name}" is currently assigned to ${assignedCount} admin${assignedCount === 1 ? "" : "s"} — reassign them first.` };
  }
  await db.adminRole.delete({ where: { id: roleId } });
  await logPrivilegedAction({ admin, permission: "roles.manage", action: "admin.role_delete", target: role.name, reason });
  revalidatePath("/admin/roles");
  return { ok: true };
}

const inviteSchema = z.object({
  name: z.string().min(1, "Name is required."),
  email: z.string().email("Enter a valid email address."),
  roleId: z.string().min(1, "Pick a role."),
  reason: z.string().min(1, "A reason is required."),
});

export type InviteAdminResult = { ok: true; email: string; password: string; emailSent: boolean } | { error: string };

// Real gap found 2026-08-23, asked directly ("is there a place... registration
// of new admins"): this page's own copy already said "New admin accounts are
// provisioned outside this UI today" — true until now. Reaching this at all
// requires roles.manage, hard-restricted to super_admin (see
// assignAdminRoleAction's own comment) — creating a platform admin is at
// least as sensitive as reassigning one, so it gets the same structural
// floor, not just a permission-list check. Mirrors inviteUserAction's
// (tenant-side) credential pattern exactly — randomToken(6), shown once,
// real email if configured — rather than a separate scheme for admins.
export async function inviteAdminAction(_prev: unknown, formData: FormData): Promise<InviteAdminResult> {
  let admin;
  try {
    admin = await assertAdminPermission("roles.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }

  const { rateLimit } = await import("./rate-limit");
  const invRate = rateLimit(`invite:admin:${admin.id}`, { max: 5, windowMs: 10 * 60 * 1000 });
  if (!invRate.ok) return { error: "Too many invites sent in a short time. Please wait a few minutes and try again." };

  const parsed = inviteSchema.safeParse({
    name: formData.get("name"), email: formData.get("email"), roleId: formData.get("roleId"), reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { name, roleId, reason } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();

  const role = await db.adminRole.findUnique({ where: { id: roleId } });
  if (!role) return { error: "Role not found." };

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: `Someone already has an account with ${email}.` };

  const scopeIds = formData.getAll("scope").map(String).filter(Boolean);
  const isSuperAdmin = role.key === "super_admin";

  const { randomToken } = await import("./crypto");
  const { hashPassword } = await import("./auth");
  const password = randomToken(6);
  const created = await db.user.create({
    data: {
      name, email, passwordHash: await hashPassword(password),
      adminRoleId: role.id, isSuperAdmin,
      adminScope: scopeIds.length > 0 ? (scopeIds as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });

  await logPrivilegedAction({ admin, permission: "roles.manage", action: "admin.invited", target: created.email, reason, newState: { roleId: role.id, roleName: role.name, isSuperAdmin, scopeIds } });

  const { isEmailConfigured, sendEmail } = await import("./notification-channels");
  let emailSent = false;
  if (isEmailConfigured()) {
    const res = await sendEmail({
      to: email,
      subject: "You've been added as a P2Less platform admin",
      text: `Hi ${name},\n\n${admin.name} added you as a platform admin (${role.name}) on P2Less.\n\nSign in at ${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/login with:\nEmail: ${email}\nPassword: ${password}\n\nYou can change your password after signing in.`,
    });
    emailSent = res.ok;
  }

  revalidatePath("/admin/roles");
  return { ok: true, email, password, emailSent };
}

const assignSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().min(1),
  reason: z.string().min(1, "A reason is required."),
});

/** Assigns (or reassigns) a platform admin's role and tenant scope. Reaching
 *  this function at all requires roles.manage, which is hard-restricted to
 *  the super_admin role — so privilege escalation via a crafted custom role
 *  is structurally impossible, not just policy. */
export async function assignAdminRoleAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("roles.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const parsed = assignSchema.safeParse({
    userId: formData.get("userId"),
    roleId: formData.get("roleId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { userId, roleId, reason } = parsed.data;

  // Safeguard: an admin cannot change their own role/scope — prevents both
  // silent self-escalation and an admin accidentally locking themselves out.
  if (userId === admin.id) {
    return { error: "You cannot change your own role. Ask another Super Admin to do this." };
  }

  const [target, role] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.adminRole.findUnique({ where: { id: roleId } }),
  ]);
  if (!target) return { error: "Admin user not found." };
  if (!role) return { error: "Role not found." };

  // Safeguard: never remove the platform's last Super Admin.
  const targetIsCurrentlySuperAdmin = target.isSuperAdmin;
  const targetWillBeSuperAdmin = role.key === "super_admin";
  if (targetIsCurrentlySuperAdmin && !targetWillBeSuperAdmin) {
    const otherSuperAdmins = await db.user.count({ where: { isSuperAdmin: true, id: { not: userId } } });
    if (otherSuperAdmins === 0) {
      return { error: "This is the last Super Admin — assign Super Admin to someone else before changing this account's role." };
    }
  }

  const scopeIds = formData.getAll("scope").map(String).filter(Boolean);

  const before = { adminRoleId: target.adminRoleId, adminScope: target.adminScope, isSuperAdmin: target.isSuperAdmin };
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      adminRoleId: role.id,
      adminScope: scopeIds.length > 0 ? (scopeIds as Prisma.InputJsonValue) : Prisma.JsonNull,
      isSuperAdmin: targetWillBeSuperAdmin,
    },
  });

  await logPrivilegedAction({
    admin, permission: "roles.manage",
    action: targetWillBeSuperAdmin && !targetIsCurrentlySuperAdmin ? "admin.super_admin_granted" : "admin.role_assigned",
    target: target.email, reason,
    previousState: before,
    newState: { adminRoleId: updated.adminRoleId, adminScope: updated.adminScope, isSuperAdmin: updated.isSuperAdmin },
  });
  revalidatePath("/admin/roles");
  return { ok: true };
}
