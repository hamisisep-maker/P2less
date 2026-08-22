"use server";

import { revalidatePath } from "next/cache";
import { db } from "./db";
import { assertAdminPermission, logPrivilegedAction, ForbiddenError } from "./admin-authz";
import { computeIntegrationHealth } from "./system-health";
import { runJobNow } from "./job-runner";

function isForbidden(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

/** Runs the real health check for one integration right now (not from the
 *  cache) and stores the result — the "Check now" button on /admin/integrations. */
export async function checkIntegrationNowAction(key: string) {
  let admin;
  try {
    admin = await assertAdminPermission("integrations.view");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  void admin;
  const verdict = await computeIntegrationHealth(key);
  const updated = await db.integration.updateMany({
    where: { key },
    data: { lastCheckedAt: new Date(), lastCheckOk: verdict.ok, lastCheckDetail: verdict.detail },
  });
  if (updated.count === 0) return { error: "Integration not found." };
  revalidatePath("/admin/integrations");
  return { ok: true, verdict };
}

// Only observability jobs (safe, idempotent, no business-state mutation) can
// be manually triggered from this generic action. Business-logic jobs
// (billing_poller, dispatch_poller, ...) keep their own dedicated,
// specifically-permissioned actions (e.g. runBillingCycleNowAction requires
// billing.manage_automation) — a read-level permission must never be able to
// early-trigger a real billing cycle or dispatch sweep through a back door.
const MANUALLY_TRIGGERABLE_JOBS = new Set(["db_health_sweep", "integration_health_sweep", "social_token_health_sweep"]);

/** Manually triggers a safe observability job right now. */
export async function runJobNowAction(jobKey: string) {
  if (!MANUALLY_TRIGGERABLE_JOBS.has(jobKey)) return { error: "This job cannot be triggered manually from here." };
  let admin;
  try {
    admin = await assertAdminPermission("system_health.view");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const result = await runJobNow(jobKey, `manual:${admin.id}`);
  revalidatePath("/admin/system-health");
  revalidatePath("/admin/integrations");
  return result;
}

/** Real functional gate, not a display toggle — payments already check this
 *  via assertChannelEnabled (payment-channels.ts); WhatsApp sending
 *  (transport.ts) and AI provider selection (ai.ts's providerChain) check it
 *  too. Disabling here genuinely stops the relevant functionality. */
export async function toggleIntegrationEnabledAction(key: string, enabled: boolean, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("integrations.manage");
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  const integration = await db.integration.findUnique({ where: { key } });
  if (!integration) return { error: "Integration not found." };
  await db.integration.update({ where: { key }, data: { enabled } });
  await logPrivilegedAction({
    admin, permission: "integrations.manage", action: enabled ? "admin.integration_enabled" : "admin.integration_disabled",
    target: integration.name, reason, previousState: { enabled: integration.enabled }, newState: { enabled },
  });
  revalidatePath("/admin/integrations");
  revalidatePath("/admin/system-health");
  revalidatePath("/admin/reconciliation");
  return { ok: true };
}
