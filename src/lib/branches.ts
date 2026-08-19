import "server-only";
import { db } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 2 (2026-08-19) — see
// docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md. Wires the Branch model
// (Phase 1) into real routing/RBAC decision points. Every function here is
// backward-compatible by construction: a tenant with only its auto-backfilled
// "Main" branch sees no behavior change, since every number/role resolves to
// that one branch either way.
// ─────────────────────────────────────────────────────────────────────────────

/** The Branch a given WhatsAppNumber is the front door for. Falls back to the
 *  tenant's isDefault branch when the number has no explicit branchId set —
 *  which is every number today, since nothing assigns branchId yet. */
export async function resolveNumberBranch(number: { branchId: string | null; tenantId: string }): Promise<{ id: string; name: string } | null> {
  if (number.branchId) {
    const branch = await db.branch.findUnique({ where: { id: number.branchId }, select: { id: true, name: true } });
    if (branch) return branch;
  }
  return db.branch.findFirst({ where: { tenantId: number.tenantId, isDefault: true }, select: { id: true, name: true } });
}

/** Does this set of branch-scoped role assignments cover the given branch?
 *  `null`/missing branchScope on ANY assignment means unrestricted (matches
 *  User.adminScope's null-means-everything convention) — mirrors, not
 *  duplicates, the platform-admin equivalent in admin-authz.ts. NOT YET
 *  called from any dashboard authorization path — see the schema comment on
 *  UserRole.branchScope for why this is deliberately unwired so far. */
export function hasBranchAccess(userRoles: { branchScope: unknown }[], branchId: string): boolean {
  return userRoles.some((ur) => {
    if (!Array.isArray(ur.branchScope)) return true; // null/undefined/malformed = unrestricted
    return (ur.branchScope as unknown[]).includes(branchId);
  });
}
