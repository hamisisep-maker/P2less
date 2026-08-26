"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { verifyPassword, hashPassword, type CurrentUser } from "./auth";
import { setSetting, setAiProviderCost, SETTING_DEFAULTS, type SettingKey } from "./platform-settings";
import { withAssertAdminPermission, logPrivilegedAction, requireAdminPermission } from "./admin-authz";
import { computeBill } from "./billing";
import { finalizeCancellation } from "./billing-lifecycle";
import { resolveTenantRecipientEmail } from "./notifications";
import { sendEmail } from "./notification-channels";
import { randomToken, encryptJSON } from "./crypto";

// re-exported so page.tsx guards (layout-level) can still import a single
// "am I even a platform admin" check without pulling in the whole authz module
export { requireAdminPermission };

// ─────────────────────────────────────────────────────────────────────────────
// Every action below re-checks its permission itself — it never trusts that
// the calling page/component already gated the button. A denial returns
// { error } (not a thrown exception) so client components can show it
// without an unhandled-rejection overlay; ForbiddenError.message says exactly
// which permission was missing.
//
// Actions marked DANGEROUS require a non-empty `reason` and write it into the
// audit trail via logPrivilegedAction — this is the "reason required" layer
// the spec calls for on elevated actions (suspend/reactivate a tenant, change
// the primary AI model, edit model pricing, edit subscription prices,
// manually confirm/resolve a payment).
// ─────────────────────────────────────────────────────────────────────────────

/** DANGEROUS: suspends/reactivates a tenant's ability to use the platform. */
export async function suspendTenantAction(tenantId: string, suspend: boolean, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  const permission = suspend ? ("tenants.suspend" as const) : ("tenants.reactivate" as const);
  return withAssertAdminPermission(permission, async (admin) => {
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
  }, { tenantId });
}

/** DANGEROUS, PERMANENT: cancels a tenant's subscription. Admin-only by
 *  explicit direction, 2026-08-24 (Gap Register item 3) — self-service was
 *  built first, then deliberately rejected in favor of this. Two real
 *  design points came out of building it the first time, both kept here:
 *
 *  1. Cutoff is unconditional and immediate (finalizeCancellation() runs
 *     first, before anything about money). Waiting for a payment to clear
 *     before cutting off access would leave a tenant who never pays fully
 *     active — and still costing Hamzone real Meta/AI money — indefinitely.
 *  2. No automated M-Pesa STK push at cancellation time — explicit direction:
 *     pushing a real-time payment prompt to a tenant's phone at the exact
 *     moment an admin is cancelling them isn't the right moment for that.
 *     Instead: what's owed for this cycle is computed, recorded as a real
 *     Payment row (status "pending", purpose "cancellation" — visible on the
 *     tenant's own billing history and to admin billing/reconciliation
 *     views, exactly like any other outstanding invoice), and emailed to the
 *     tenant's owner as an itemized final bill via Resend. Deliberately NOT
 *     built in this round: a tenant-facing "pay this old invoice" flow — an
 *     admin with billing.confirm_payment can mark it paid once money arrives
 *     by whatever channel, same as any other manual reconciliation today. */
export async function cancelTenantSubscriptionAction(tenantId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("tenants.cancel", async (admin) => {
    const [tenant, sub] = await Promise.all([
      db.tenant.findUnique({ where: { id: tenantId } }),
      db.subscription.findUnique({ where: { tenantId } }),
    ]);
    if (!tenant || !sub) return { error: "Tenant or subscription not found." };
    if (sub.status === "cancelled") return { error: "This subscription is already cancelled." };

    const bill = await computeBill(tenantId);
    const period = bill.periodLabel;
    const alreadyPaid = await db.payment.aggregate({
      where: { tenantId, purpose: "subscription", status: "paid", periodLabel: period },
      _sum: { amount: true },
    });
    const outstanding = Math.max(0, bill.total - (alreadyPaid._sum.amount ?? 0));

    // Cutoff — before anything about the outstanding balance is touched.
    await finalizeCancellation(tenantId);

    let emailSent = false;
    let emailError: string | undefined;
    let reference: string | undefined;
    if (outstanding > 0) {
      reference = "CANCEL-" + randomToken(4).toUpperCase();
      await db.payment.create({
        data: { tenantId, reference, amount: outstanding, currency: "KES", purpose: "cancellation", method: "mpesa", status: "pending", provider: "manual", periodLabel: period },
      });
      const email = await resolveTenantRecipientEmail(tenantId);
      if (email) {
        const itemLines = [
          `${bill.planName} plan — KES ${bill.planFee.toLocaleString("en-US")}`,
          ...bill.lines.map((l) => `${l.label} (${l.qty} × KES ${l.unit}) — KES ${l.amount.toLocaleString("en-US")}`),
        ].join("\n");
        const result = await sendEmail({
          to: email,
          subject: `${tenant.name} — final P2Less invoice (subscription cancelled)`,
          text: `Your P2Less subscription for ${tenant.name} has been cancelled.\n\nFinal invoice for ${period}:\n${itemLines}\n\nTotal due: KES ${outstanding.toLocaleString("en-US")}\nReference: ${reference}\n\nWe'll follow up on payment for this final balance. Contact us if you have questions.`,
        });
        emailSent = result.ok;
        if (!result.ok) emailError = result.error;
      } else {
        emailError = "No recipient email on file for this tenant.";
      }
    }

    await logPrivilegedAction({
      admin, permission: "tenants.cancel", tenantId,
      action: "admin.tenant_cancelled", target: tenant.name, reason,
      detail: { outstanding, reference, emailSent, emailError },
    });
    revalidatePath("/admin");
    revalidatePath("/admin/tenants");
    return { ok: true, outstanding, emailSent, emailError };
  }, { tenantId });
}

/** DANGEROUS: assigns a tenant to a different plan — admin side, handles
 *  BOTH directions. Distinct from updatePlanAction below, which edits the
 *  GLOBAL plan definition (price, limits), not which plan a tenant is on —
 *  the exact confusion this Gap Register item started from (grepped for
 *  every planId write and found none, anywhere, outside signup).
 *
 *  Direction is read from Plan.sort (the field that exists specifically for
 *  tier ordering), NOT priceMonthly — checked the real seed data first:
 *  Enterprise is priced at 0, same as Free, but is obviously the top tier,
 *  so comparing by price alone would have gotten this backwards.
 *
 *  Upgrade (new sort > current): applied IMMEDIATELY — planId changes right
 *  away. Explicit, honest rule: the CURRENT month's bill (computeBill()
 *  reads plan.priceMonthly fresh against usage counted since the start of
 *  the calendar month, no per-day plan history) will charge the new,
 *  higher rate for the whole month, no partial-month credit — safe because
 *  it only ever increases revenue, never something a tenant could use to
 *  reduce what they owe.
 *
 *  Downgrade (new sort < current): NEVER immediate — sets
 *  Subscription.pendingPlanId instead, applied by runBillingCycle() at the
 *  next real renewal (billing-lifecycle.ts). Applying a downgrade
 *  immediately would retroactively apply the LOWER rate to usage already
 *  incurred this cycle at the higher one — exactly the "change plan right
 *  before the bill" gaming risk this was designed to close. This is also
 *  why downgrades are admin-only, not self-service (see
 *  createUpgradeInvoiceAction in invoicing.ts for the tenant-facing half). */
export async function changeTenantPlanAction(tenantId: string, newPlanId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("tenants.change_plan", async (admin) => {
    const [tenant, sub, newPlan] = await Promise.all([
      db.tenant.findUnique({ where: { id: tenantId } }),
      db.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      db.plan.findUnique({ where: { id: newPlanId } }),
    ]);
    if (!tenant || !sub) return { error: "Tenant or subscription not found." };
    if (!newPlan || !newPlan.active) return { error: "That plan isn't available." };
    if (newPlan.id === sub.planId) return { error: `Already on ${newPlan.name}.` };

    const isUpgrade = newPlan.sort > sub.plan.sort;
    if (isUpgrade) {
      await db.subscription.update({ where: { tenantId }, data: { planId: newPlan.id, pendingPlanId: null } });
    } else {
      await db.subscription.update({ where: { tenantId }, data: { pendingPlanId: newPlan.id } });
    }

    await logPrivilegedAction({
      admin, permission: "tenants.change_plan", tenantId,
      action: isUpgrade ? "admin.tenant_plan_upgraded" : "admin.tenant_plan_downgrade_scheduled",
      target: tenant.name, reason,
      previousState: { plan: sub.plan.name }, newState: { plan: newPlan.name, effective: isUpgrade ? "immediate" : "next renewal" },
    });
    revalidatePath("/admin/tenants");
    revalidatePath(`/admin/tenants/${tenantId}`);
    return { ok: true, isUpgrade, effective: isUpgrade ? "immediate" : "next renewal", planName: newPlan.name };
  }, { tenantId });
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
  return withAssertAdminPermission("plans.edit", async (admin) => {
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
  });
}

const pricingSchema = z.object({
  price_conversation_kes: z.coerce.number().min(0),
  price_ai_kes: z.coerce.number().min(0),
  price_document_kes: z.coerce.number().min(0),
  cost_conversation_kes: z.coerce.number().min(0),
  cost_document_kes: z.coerce.number().min(0),
  // Unofficial (Baileys) WhatsApp transport billing, 2026-08-26 — a
  // checkbox posts "on" when checked and is simply absent from the FormData
  // when unchecked, so this coerces that presence/absence into 0/1 the same
  // way every other 0/1 PlatformSetting toggle is stored (see
  // billing_auto_suspend_enabled's own comment in platform-settings.ts).
  baileys_billing_active: z.coerce.number().min(0).max(1).default(0),
  baileys_discount_multiplier: z.coerce.number().min(0).max(1),
});

export async function updatePricingSettingsAction(_prev: unknown, formData: FormData) {
  return withAssertAdminPermission("billing.manage_pricing", async (admin) => {
    const parsed = pricingSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { error: "Prices/costs must be numbers (0 or more)." };
    for (const [key, value] of Object.entries(parsed.data)) {
      await setSetting(key as SettingKey, String(value));
    }
    await logPrivilegedAction({ admin, permission: "billing.manage_pricing", action: "admin.pricing_update", detail: parsed.data });
    revalidatePath("/admin/billing");
    return { ok: true };
  });
}

export async function updateAiProviderCostAction(_prev: unknown, formData: FormData) {
  return withAssertAdminPermission("providers.manage", async (admin) => {
    const provider = String(formData.get("provider") ?? "");
    const cost = Number(formData.get("costPerCallKes"));
    if (!provider || !Number.isFinite(cost) || cost < 0) return { error: "Enter a valid cost." };
    await setAiProviderCost(provider, cost);
    await logPrivilegedAction({ admin, permission: "providers.manage", action: "admin.ai_cost_update", target: provider, detail: { costPerCallKes: cost } });
    revalidatePath("/admin/ai");
    revalidatePath("/admin/billing");
    return { ok: true };
  });
}

// ── Real, admin-editable AI provider keys, 2026-08-26 ─────────────────────────
// Wires IntegrationCredential up as a real runtime source for the first time
// (see the model's own schema comment) — one row per key, numbered "Key 1" /
// "Key 2" / ... by creation order in the UI, never a stored ordinal. Never logs
// or audits the raw key value — only the masked preview, matching audit()'s
// own sanitize() stripping anything matching /password|secret|token|apikey/i.
function maskKey(key: string): string {
  const tail = key.length > 4 ? key.slice(-4) : key;
  return `••••••••••${tail}`;
}

export async function addAiProviderKeyAction(_prev: unknown, formData: FormData) {
  return withAssertAdminPermission("providers.manage", async (admin) => {
    const provider = String(formData.get("provider") ?? "");
    const key = String(formData.get("key") ?? "").trim();
    const startingBalanceRaw = formData.get("startingBalanceUsd");
    const startingBalanceUsd = startingBalanceRaw && String(startingBalanceRaw).trim() !== "" ? Number(startingBalanceRaw) : null;
    if (!provider || !key) return { error: "Paste a real key." };
    if (startingBalanceUsd != null && (!Number.isFinite(startingBalanceUsd) || startingBalanceUsd < 0)) return { error: "Starting balance must be a number 0 or more." };

    const integration = await db.integration.findUnique({ where: { key: `ai_${provider}` } });
    if (!integration) return { error: "Unknown provider." };

    await db.integrationCredential.create({
      data: {
        integrationId: integration.id,
        label: "api_key",
        valueEnc: encryptJSON({ key }),
        maskedPreview: maskKey(key),
        active: true,
        createdById: admin.id,
        startingBalanceUsd,
      },
    });
    const { refreshDbProviderKeys } = await import("./ai");
    await refreshDbProviderKeys();

    await logPrivilegedAction({ admin, permission: "providers.manage", action: "admin.ai_key_added", target: provider, detail: { maskedPreview: maskKey(key), startingBalanceUsd } });
    revalidatePath("/admin/ai");
    return { ok: true };
  });
}

export async function revokeAiProviderKeyAction(credentialId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("providers.manage", async (admin) => {
    const cred = await db.integrationCredential.findUnique({ where: { id: credentialId }, include: { integration: true } });
    if (!cred) return { error: "Key not found." };
    await db.integrationCredential.update({ where: { id: credentialId }, data: { active: false, revokedAt: new Date() } });
    const { refreshDbProviderKeys } = await import("./ai");
    await refreshDbProviderKeys();

    await logPrivilegedAction({
      admin, permission: "providers.manage", action: "admin.ai_key_revoked",
      target: cred.integration.key.replace("ai_", ""), reason,
      previousState: { active: true }, newState: { active: false },
    });
    revalidatePath("/admin/ai");
    return { ok: true };
  });
}

/** DANGEROUS: pauses AI for every tenant except one — direct request while
 *  running P2Less's own internal training, so training doesn't compete with
 *  real tenant traffic for shared provider quota. Empty tenantId restores
 *  normal operation for everyone (a real, single-click undo, not just "set
 *  it back manually"). Enforced in ai.ts's callLLM() — see the cache/check
 *  there for exactly how a paused tenant's AI call degrades (same "null,
 *  every caller already has a graceful fallback" shape as every other AI
 *  gate in this codebase, not a new failure mode). */
export async function setAiPauseExceptTenantAction(tenantId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("models.change_primary", async (admin) => {
    let targetName = "(none — normal operation restored)";
    if (tenantId) {
      const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      if (!tenant) return { error: "Tenant not found." };
      targetName = tenant.name;
    }
    const before = await db.platformSetting.findUnique({ where: { key: "ai_paused_except_tenant_id" } });
    await setSetting("ai_paused_except_tenant_id", tenantId);
    const { refreshAiPauseCache } = await import("./ai");
    await refreshAiPauseCache();

    await logPrivilegedAction({
      admin, permission: "models.change_primary", action: "admin.ai_pause_except_tenant_change",
      target: targetName, reason,
      previousState: { value: before?.value ?? "" }, newState: { value: tenantId },
    });
    revalidatePath("/admin/ai");
    return { ok: true };
  });
}

/** DANGEROUS: changes which AI provider serves live traffic. */
export async function setPrimaryProviderAction(provider: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("models.change_primary", async (admin) => {
    const before = await db.platformSetting.findUnique({ where: { key: "ai_primary_provider" } });
    await setSetting("ai_primary_provider", provider);
    await logPrivilegedAction({
      admin, permission: "models.change_primary", action: "admin.ai_primary_provider_change",
      target: provider || "(auto)", reason,
      previousState: { provider: before?.value ?? "(auto)" }, newState: { provider: provider || "(auto)" },
    });
    revalidatePath("/admin/ai");
    return { ok: true };
  });
}

export async function resetPricingDefaultsAction() {
  return withAssertAdminPermission("billing.manage_pricing", async (admin) => {
    for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
      if (key === "ai_primary_provider") continue;
      await setSetting(key, String(SETTING_DEFAULTS[key]));
    }
    await logPrivilegedAction({ admin, permission: "billing.manage_pricing", action: "admin.pricing_reset_defaults" });
    revalidatePath("/admin/billing");
    return { ok: true };
  });
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
  return withAssertAdminPermission("models.edit_pricing", async (admin) => {
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
  });
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
  return withAssertAdminPermission("billing.manage_automation", async (admin) => {
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
  });
}

const notificationRuleSchema = z.object({
  event: z.string().min(1),
  channel: z.string().min(1),
  timingDays: z.coerce.number().int().min(0).optional(),
  template: z.string().optional(),
});

export async function upsertNotificationRuleAction(_prev: unknown, formData: FormData) {
  return withAssertAdminPermission("notifications.manage", async (admin) => {
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
  });
}

export async function toggleNotificationRuleAction(ruleId: string, enabled: boolean) {
  return withAssertAdminPermission("notifications.manage", async (admin) => {
    const rule = await db.notificationRule.update({ where: { id: ruleId }, data: { enabled } });
    await logPrivilegedAction({ admin, permission: "notifications.manage", action: "admin.notification_rule_toggle", target: `${rule.event}/${rule.channel}`, detail: { enabled } });
    revalidatePath("/admin/billing/automation");
    return { ok: true };
  });
}

/** DANGEROUS: this is the platform's "manually confirm payment" control —
 *  resolves a payment left ambiguous (STK push sent, no webhook received in
 *  the reconciliation window) instead of waiting on Daraja. A subscription
 *  flagged reconciliationNeeded never auto-progresses; this is the deliberate
 *  manual escape hatch after an admin has actually verified what happened. */
export async function clearReconciliationAction(tenantId: string, resolution: "paid" | "failed", reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("billing.confirm_payment", async (admin) => {
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
  }, { tenantId });
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
  return withAssertAdminPermission("billing.confirm_payment", async (admin) => {
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
  }, { tenantId });
}

/** Runs the billing cycle immediately instead of waiting for the poller's
 *  next tick — for verifying the automation actually works, or catching up
 *  right after changing a setting. */
export async function runBillingCycleNowAction() {
  return withAssertAdminPermission("billing.manage_automation", async (admin) => {
    const { runBillingCycle } = await import("./billing-lifecycle");
    const result = await runBillingCycle();
    await logPrivilegedAction({ admin, permission: "billing.manage_automation", action: "admin.billing_cycle_manual_run", detail: result });
    revalidatePath("/admin/billing/automation");
    revalidatePath("/admin/tenants");
    return { ok: true, ...result };
  });
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
  return withAssertAdminPermission("billing.refund", async (admin) => {
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
  }, { tenantId: payment.tenantId });
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

/** Self-service — any platform admin may change their OWN password. Not
 *  gated by a granular permission (it only ever touches the caller's own
 *  User row), just by "is a logged-in platform admin at all". */
export async function changeAdminPasswordAction(_prev: unknown, formData: FormData) {
  // withAdminPermissionAny(), not requireSuperAdmin() + continue in this
  // function's own body — same set-then-return AsyncLocalStorage bug as
  // every other guard in this file (see admin-authz.ts's comment). This one
  // isn't gated by a specific AdminPermission (self-service, any platform
  // admin), so it re-enters cross-tenant context directly rather than going
  // through withAdminPermission/withAssertAdminPermission.
  return withAdminPermissionAny(async (admin) => {
    const parsed = passwordSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
    const user = await db.user.findUnique({ where: { id: admin.id } });
    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return { error: "Current password is incorrect." };
    }
    await db.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword), passwordChangedAt: new Date() } });
    return { ok: true, message: "Password updated." };
  });
}

async function withAdminPermissionAny<T>(fn: (admin: CurrentUser) => Promise<T>): Promise<T> {
  const { requireSuperAdmin } = await import("./auth");
  const { enterCrossTenantContext } = await import("./tenant-context");
  const admin = await requireSuperAdmin();
  enterCrossTenantContext();
  return fn(admin);
}
