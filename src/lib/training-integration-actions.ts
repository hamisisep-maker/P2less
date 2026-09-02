"use server";

import { revalidatePath } from "next/cache";
import { db } from "./db";
import { withAssertAdminPermission, logPrivilegedAction } from "./admin-authz";

// ─────────────────────────────────────────────────────────────────────────────
// The credential kill-switch for the Hamzone AI Training & Evaluation
// platform integration (docs/integrations/HAMZONE-AI-TRAINING-2026-09-02.md
// here; that repo's own docs/PHASE5-CAMPAIGN-PLAN-2026-09-02.md is what
// asked for this specifically — "disable a credential without redeploying,
// deleting secrets, or changing code"). Reuses TrainingIntegrationCredential
// .revokedAt, the exact field src/lib/training-auth.ts already checks on
// every request — no new field, no new enforcement path, just a UI over
// the primitive that was already there.
// ─────────────────────────────────────────────────────────────────────────────

export async function revokeTrainingCredentialAction(credentialId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("integrations.manage_credentials", async (admin) => {
    const credential = await db.trainingIntegrationCredential.findUnique({ where: { id: credentialId } });
    if (!credential) return { error: "Credential not found." };
    if (credential.revokedAt) return { ok: true }; // already revoked — nothing to do

    await db.trainingIntegrationCredential.update({ where: { id: credentialId }, data: { revokedAt: new Date() } });
    await logPrivilegedAction({
      admin, permission: "integrations.manage_credentials", action: "training_credential.revoked",
      target: credential.name, reason,
      detail: { credentialId },
    });
    revalidatePath("/admin/integrations");
    return { ok: true };
  });
}

export async function reactivateTrainingCredentialAction(credentialId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("integrations.manage_credentials", async (admin) => {
    const credential = await db.trainingIntegrationCredential.findUnique({ where: { id: credentialId } });
    if (!credential) return { error: "Credential not found." };
    if (!credential.revokedAt) return { ok: true }; // already active — nothing to do

    await db.trainingIntegrationCredential.update({ where: { id: credentialId }, data: { revokedAt: null } });
    await logPrivilegedAction({
      admin, permission: "integrations.manage_credentials", action: "training_credential.reactivated",
      target: credential.name, reason,
      detail: { credentialId },
    });
    revalidatePath("/admin/integrations");
    return { ok: true };
  });
}
