"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { verifyPassword, hashPassword } from "./auth";
import { setSetting, setAiProviderCost, SETTING_DEFAULTS, type SettingKey } from "./platform-settings";
import { assertAdminPermission, logPrivilegedAction, ForbiddenError, requireAdminPermission } from "./admin-authz";

// re-exported so page.tsx guards (layout-level) can still import a single
// "am I even a platform admin" check without pulling in the whole authz module
export { requireAdminPermission };

// ─────────────────────────────────────────────────────────────────────────────
// Every action below re-checks assertAdminPermission() itself — it never
// trusts that the calling page/component already gated the button. A denial
// returns { error } (not a thrown exception) so client components can show it
// without an unhandled-rejection overlay; ForbiddenError.message says exactly
// which permission was missing.
//
// Actions marked DANGEROUS require a non-empty `reason` and write it into the
// audit trail via logPrivilegedAction — this is the "reason required" layer
// the spec calls for on elevated actions (suspend/reactivate a tenant, change
// the primary AI model, edit model pricing, edit subscription prices,
// manually confirm/resolve a payment).
// ─────────────────────────────────────────────────────────────────────────────

function isForbidden(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

/** DANGEROUS: suspends/reactivates a tenant's ability to use the platform. */
export async function suspendTenantAction(tenantId: string, suspend: boolean, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  const permission = suspend ? ("tenants.suspend" as const) : ("tenants.reactivate" as const);
  let admin;
  try {
    admin = await assertAdminPermission(permission, { tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const before = await db.tenant.findUnique({ where: { id: tenantId } });
  const tenant = await db.tenant.update({ where: { id: tenantId }, data: { status: suspend ? "suspended" : "active" } });
  await logPrivilegedAction({
    admin, permission, tenantId,
    action: suspend ? "admin.tenant_suspend" : "admin.tenant_activate",
    target: tenant.name, reason,
    previousState: { status: before?.status }, newState: { status: tenant.status },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  return { ok: true };
}

const planSchema = z.object({
  planId: z.string().min(1),
  priceMonthly: z.coerce.number().int().min(0),
  messagesPerMonth: z.coerce.number().int().min(0),
  aiRequestsPerMonth: z.coerce.number().int().min(0),
  documentsPerMonth: z.coerce.number().int().min(0),
  users: z.coerce.number().int().min(0),
  connectors: z.coerce.number().int().min(0),
  active: z.coerce.boolean().optional(),
  reason: z.string().min(1, "A reason is required."),
});

/** DANGEROUS: changes what tenants are charged. */
export async function updatePlanAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("plans.edit");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const raw = Object.fromEntries(formData.entries());
  const parsed = planSchema.safeParse({ ...raw, active: formData.get("active") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the plan values — all limits must be whole numbers." };
  const d = parsed.data;
  const before = await db.plan.findUnique({ where: { id: d.planId } });
  const plan = await db.plan.update({
    where: { id: d.planId },
    data: {
      priceMonthly: d.priceMonthly,
      active: d.active ?? false,
      limits: {
        users: d.users || undefined,
        messagesPerMonth: d.messagesPerMonth || undefined,
        connectors: d.connectors || undefined,
        aiRequestsPerMonth: d.aiRequestsPerMonth || undefined,
        documentsPerMonth: d.documentsPerMonth || undefined,
      },
    },
  });
  await logPrivilegedAction({
    admin, permission: "plans.edit", action: "admin.plan_update", target: plan.name, reason: d.reason,
    previousState: { priceMonthly: before?.priceMonthly, active: before?.active },
    newState: { priceMonthly: d.priceMonthly, active: d.active },
  });
  revalidatePath("/admin/billing");
  return { ok: true };
}

const pricingSchema = z.object({
  price_conversation_kes: z.coerce.number().min(0),
  price_ai_kes: z.coerce.number().min(0),
  price_document_kes: z.coerce.number().min(0),
  cost_conversation_kes: z.coerce.number().min(0),
  cost_document_kes: z.coerce.number().min(0),
});

export async function updatePricingSettingsAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("billing.manage_pricing");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const parsed = pricingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Prices/costs must be numbers (0 or more)." };
  for (const [key, value] of Object.entries(parsed.data)) {
    await setSetting(key as SettingKey, String(value));
  }
  await logPrivilegedAction({ admin, permission: "billing.manage_pricing", action: "admin.pricing_update", detail: parsed.data });
  revalidatePath("/admin/billing");
  return { ok: true };
}

export async function updateAiProviderCostAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("providers.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const provider = String(formData.get("provider") ?? "");
  const cost = Number(formData.get("costPerCallKes"));
  if (!provider || !Number.isFinite(cost) || cost < 0) return { error: "Enter a valid cost." };
  await setAiProviderCost(provider, cost);
  await logPrivilegedAction({ admin, permission: "providers.manage", action: "admin.ai_cost_update", target: provider, detail: { costPerCallKes: cost } });
  revalidatePath("/admin/ai");
  revalidatePath("/admin/billing");
  return { ok: true };
}

/** DANGEROUS: changes which AI provider serves live traffic. */
export async function setPrimaryProviderAction(provider: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("models.change_primary");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const before = await db.platformSetting.findUnique({ where: { key: "ai_primary_provider" } });
  await setSetting("ai_primary_provider", provider);
  await logPrivilegedAction({
    admin, permission: "models.change_primary", action: "admin.ai_primary_provider_change",
    target: provider || "(auto)", reason,
    previousState: { provider: before?.value ?? "(auto)" }, newState: { provider: provider || "(auto)" },
  });
  revalidatePath("/admin/ai");
  return { ok: true };
}

export async function resetPricingDefaultsAction() {
  let admin;
  try {
    admin = await assertAdminPermission("billing.manage_pricing");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    if (key === "ai_primary_provider") continue;
    await setSetting(key, String(SETTING_DEFAULTS[key]));
  }
  await logPrivilegedAction({ admin, permission: "billing.manage_pricing", action: "admin.pricing_reset_defaults" });
  revalidatePath("/admin/billing");
  return { ok: true };
}

const modelPricingSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  inputPerMillionUsd: z.coerce.number().min(0),
  outputPerMillionUsd: z.coerce.number().min(0),
  reason: z.string().min(1, "A reason is required."),
});

/** DANGEROUS: adds a new versioned price row (never edits in place — see
 *  ModelPricing's schema comment) that future cost calculations use. */
export async function addModelPricingAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("models.edit_pricing");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const parsed = modelPricingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter a valid provider, model name, and prices (0 or more)." };
  const d = parsed.data;
  await db.modelPricing.create({ data: { provider: d.provider, model: d.model, inputPerMillionUsd: d.inputPerMillionUsd, outputPerMillionUsd: d.outputPerMillionUsd, setById: admin.id } });
  await logPrivilegedAction({
    admin, permission: "models.edit_pricing", action: "admin.model_pricing_set", target: `${d.provider}/${d.model}`, reason: d.reason,
    newState: { inputPerMillionUsd: d.inputPerMillionUsd, outputPerMillionUsd: d.outputPerMillionUsd },
  });
  revalidatePath("/admin/models");
  revalidatePath("/admin/billing");
  return { ok: true };
}

const billingAutomationSchema = z.object({
  billing_grace_period_days: z.coerce.number().int().min(0),
  billing_reminder_days: z.string().min(1),
  billing_max_retries: z.coerce.number().int().min(1),
  billing_retry_interval_hours: z.coerce.number().int().min(1),
  billing_reconciliation_window_hours: z.coerce.number().min(0.1),
  billing_auto_suspend_enabled: z.coerce.boolean().optional(),
  billing_auto_renew_charge_enabled: z.coerce.boolean().optional(),
});

export async function updateBillingAutomationAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("billing.manage_automation");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const raw = Object.fromEntries(formData.entries());
  const parsed = billingAutomationSchema.safeParse({
    ...raw,
    billing_auto_suspend_enabled: formData.get("billing_auto_suspend_enabled") === "on",
    billing_auto_renew_charge_enabled: formData.get("billing_auto_renew_charge_enabled") === "on",
  });
  if (!parsed.success) return { error: "Check the automation settings — days/hours must be valid numbers." };
  for (const [key, value] of Object.entries(parsed.data)) {
    await setSetting(key as SettingKey, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  await logPrivilegedAction({ admin, permission: "billing.manage_automation", action: "admin.billing_automation_update", detail: parsed.data });
  revalidatePath("/admin/billing/automation");
  return { ok: true };
}

const notificationRuleSchema = z.object({
  event: z.string().min(1),
  channel: z.string().min(1),
  timingDays: z.coerce.number().int().min(0).optional(),
  template: z.string().optional(),
});

export async function upsertNotificationRuleAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("notifications.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const timingDaysRaw = formData.get("timingDays");
  const parsed = notificationRuleSchema.safeParse({
    event: formData.get("event"), channel: formData.get("channel"),
    timingDays: timingDaysRaw && timingDaysRaw !== "" ? timingDaysRaw : undefined,
    template: formData.get("template") || undefined,
  });
  if (!parsed.success) return { error: "Pick a real event and channel." };
  const d = parsed.data;
  const timingDays = d.timingDays ?? 0;
  await db.notificationRule.upsert({
    where: { event_channel_timingDays: { event: d.event, channel: d.channel, timingDays } },
    create: { event: d.event, channel: d.channel, timingDays, template: d.template, enabled: true },
    update: { template: d.template },
  });
  await logPrivilegedAction({ admin, permission: "notifications.manage", action: "admin.notification_rule_set", target: `${d.event}/${d.channel}`, detail: d });
  revalidatePath("/admin/billing/automation");
  return { ok: true };
}

export async function toggleNotificationRuleAction(ruleId: string, enabled: boolean) {
  let admin;
  try {
    admin = await assertAdminPermission("notifications.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const rule = await db.notificationRule.update({ where: { id: ruleId }, data: { enabled } });
  await logPrivilegedAction({ admin, permission: "notifications.manage", action: "admin.notification_rule_toggle", target: `${rule.event}/${rule.channel}`, detail: { enabled } });
  revalidatePath("/admin/billing/automation");
  return { ok: true };
}

/** DANGEROUS: this is the platform's "manually confirm payment" control —
 *  resolves a payment left ambiguous (STK push sent, no webhook received in
 *  the reconciliation window) instead of waiting on Daraja. A subscription
 *  flagged reconciliationNeeded never auto-progresses; this is the deliberate
 *  manual escape hatch after an admin has actually verified what happened. */
export async function clearReconciliationAction(tenantId: string, resolution: "paid" | "failed", reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("billing.confirm_payment", { tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  if (resolution === "paid") {
    const sub = await db.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (sub) {
      const { reactivateAfterPayment } = await import("./billing-lifecycle");
      await reactivateAfterPayment(tenantId, sub.plan);
    }
  } else {
    await db.subscription.update({ where: { tenantId }, data: { reconciliationNeeded: false } });
    const { recordFailedPayment } = await import("./billing-lifecycle");
    await recordFailedPayment(tenantId, "Manually resolved by admin as failed");
  }
  await logPrivilegedAction({
    admin, permission: "billing.confirm_payment", tenantId, action: "admin.reconciliation_resolved",
    target: tenantId, reason, newState: { resolution },
  });
  revalidatePath("/admin/tenants");
  revalidatePath("/admin/billing/automation");
  return { ok: true };
}

/** Real gap found in a schema-drift audit, 2026-08-23: `Subscription.
 *  paybillReference` is read by the real C2B PayBill confirmation webhook
 *  (src/app/api/payments/mpesa/c2b/confirmation/route.ts) to auto-match a
 *  direct PayBill deposit to a tenant, but nothing anywhere ever set it —
 *  confirmed 0 of 10 real subscriptions had a value. Every direct PayBill
 *  payment was silently falling through to the manual reconciliation queue
 *  instead of auto-matching. This is the missing write side: an admin
 *  assigns the reference per tenant, same as the schema comment always
 *  said was the intended flow. Empty string clears it. */
export async function setPaybillReferenceAction(tenantId: string, paybillReference: string) {
  const clean = paybillReference.trim();
  let admin;
  try {
    admin = await assertAdminPermission("billing.confirm_payment", { tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  try {
    await db.subscription.update({ where: { tenantId }, data: { paybillReference: clean || null } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That PayBill reference is already assigned to a different tenant." };
    }
    throw e;
  }
  await logPrivilegedAction({
    admin, permission: "billing.confirm_payment", tenantId, action: "admin.paybill_reference_set",
    target: tenantId, newState: { paybillReference: clean || null },
  });
  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true };
}

/** Runs the billing cycle immediately instead of waiting for the poller's
 *  next tick — for verifying the automation actually works, or catching up
 *  right after changing a setting. */
export async function runBillingCycleNowAction() {
  let admin;
  try {
    admin = await assertAdminPermission("billing.manage_automation");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const { runBillingCycle } = await import("./billing-lifecycle");
  const result = await runBillingCycle();
  await logPrivilegedAction({ admin, permission: "billing.manage_automation", action: "admin.billing_cycle_manual_run", detail: result });
  revalidatePath("/admin/billing/automation");
  revalidatePath("/admin/tenants");
  return { ok: true, ...result };
}

/** DANGEROUS: an administrative refund RECORD, not an automated real-money
 *  reversal. Marks the payment refunded and reflects it in tenant billing
 *  history. Actually returning M-Pesa funds requires Safaricom's separate B2C
 *  reversal API, which is not wired in here — the UI states this plainly so
 *  no one mistakes this for a real money-back-to-customer flow. */
export async function refundPaymentAction(paymentId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return { error: "Payment not found." };
  let admin;
  try {
    admin = await assertAdminPermission("billing.refund", { tenantId: payment.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  if (payment.status !== "paid") return { error: `Only a paid payment can be refunded (this one is "${payment.status}").` };
  const updated = await db.payment.update({ where: { id: paymentId }, data: { status: "refunded" } });
  await logPrivilegedAction({
    admin, permission: "billing.refund", tenantId: payment.tenantId, action: "admin.payment_refunded",
    target: payment.reference, reason,
    previousState: { status: payment.status }, newState: { status: updated.status },
    detail: { amount: payment.amount, currency: payment.currency, note: "Administrative record only — no automated money movement." },
  });
  revalidatePath("/admin/billing");
  revalidatePath("/admin/tenants");
  return { ok: true };
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

/** Self-service — any platform admin may change their OWN password. Not
 *  gated by a granular permission (it only ever touches the caller's own
 *  User row), just by "is a logged-in platform admin at all". */
export async function changeAdminPasswordAction(_prev: unknown, formData: FormData) {
  const admin = await requireAdminPermissionAny();
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const user = await db.user.findUnique({ where: { id: admin.id } });
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return { error: "Current password is incorrect." };
  }
  await db.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword), passwordChangedAt: new Date() } });
  return { ok: true, message: "Password updated." };
}

async function requireAdminPermissionAny() {
  const { requireSuperAdmin } = await import("./auth");
  return requireSuperAdmin();
}
