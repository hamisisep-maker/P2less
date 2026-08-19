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
