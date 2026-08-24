"use server";

import { revalidatePath } from "next/cache";
import { assertAdminPermission, logPrivilegedAction, ForbiddenError } from "./admin-authz";
import { setSetting } from "./platform-settings";

function isForbidden(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

const CONFIRMATION_PHRASE = "MAINTENANCE";

/** Whole-PLATFORM maintenance — deliberately the hardest action to trigger
 *  in this entire system: requires maintenance.manage AND a typed
 *  confirmation phrase AND a non-empty reason, on top of the standard
 *  audit trail. Distinct from disabling one Integration (see
 *  toggleIntegrationEnabledAction in integrations-actions.ts), which only
 *  affects that one dependency. */
export async function enableMaintenanceModeAction(_prev: unknown, formData: FormData) {
  const typedConfirmation = String(formData.get("typedConfirmation") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const durationMinutes = Number(formData.get("durationMinutes") ?? 30);
  const message = String(formData.get("message") ?? "");

  if (typedConfirmation !== CONFIRMATION_PHRASE) return { error: `Type "${CONFIRMATION_PHRASE}" exactly to confirm.` };
  if (!reason.trim()) return { error: "A reason is required." };
  if (!message.trim()) return { error: "A message to show users is required." };

  let admin;
  try {
    admin = await assertAdminPermission("maintenance.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }

  await setSetting("maintenance_enabled", "1");
  await setSetting("maintenance_reason", reason);
  await setSetting("maintenance_started_at", new Date().toISOString());
  await setSetting("maintenance_expected_duration_minutes", String(Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 30));
  await setSetting("maintenance_message", message);

  await logPrivilegedAction({
    admin, permission: "maintenance.manage", action: "admin.maintenance_enabled", reason,
    detail: { durationMinutes, message },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function disableMaintenanceModeAction(reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("maintenance.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await setSetting("maintenance_enabled", "0");
  await logPrivilegedAction({ admin, permission: "maintenance.manage", action: "admin.maintenance_disabled", reason });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The /onboard off switch — much lower blast radius than whole-platform
 *  maintenance (blocks new signups only, existing tenants unaffected), so
 *  no typed confirmation, just a required reason for the audit trail.
 *  Reuses maintenance.manage rather than a new permission — same "platform-
 *  wide risk control, highest-trust roles only" category. Enforced in two
 *  places: the /onboard page hides the form when off, and
 *  requestOnboardOtpAction checks it independently so a direct call is
 *  blocked too, not just the UI. */
export async function setPublicRegistrationEnabledAction(enabled: boolean, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("maintenance.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await setSetting("public_registration_enabled", enabled ? "1" : "0");
  await logPrivilegedAction({
    admin, permission: "maintenance.manage", action: enabled ? "admin.public_registration_enabled" : "admin.public_registration_disabled", reason,
  });
  revalidatePath("/onboard");
  revalidatePath("/admin/system-health");
  return { ok: true };
}

/** The Public Feedback / Quality Centre's Phase B invitation, shown on the
 *  landing page (docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md). The
 *  reporting mechanism (the widget) already works for anyone regardless of
 *  this setting — this ONLY controls whether the public invitation copy is
 *  DISPLAYED, so the user can run an invite-only pilot first and switch to
 *  public on their own timing, not a date baked into a deploy. Same low-
 *  blast-radius shape as public registration: reused permission, required
 *  reason, no typed confirmation. */
export async function setQualityFeedbackInvitationEnabledAction(enabled: boolean, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("maintenance.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await setSetting("quality_feedback_invitation_enabled", enabled ? "1" : "0");
  await logPrivilegedAction({
    admin, permission: "maintenance.manage", action: enabled ? "admin.quality_feedback_invitation_enabled" : "admin.quality_feedback_invitation_disabled", reason,
  });
  revalidatePath("/");
  revalidatePath("/admin/system-health");
  return { ok: true };
}
