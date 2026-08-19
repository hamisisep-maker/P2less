"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { requireSuperAdmin, verifyPassword, hashPassword } from "./auth";
import { setSetting, setAiProviderCost, SETTING_DEFAULTS, type SettingKey } from "./platform-settings";
import { audit } from "./audit";
import { requestId as newRequestId } from "./crypto";

/** Accountability trail for admin actions that aren't scoped to one tenant. */
async function auditPlatform(admin: { id: string; email: string }, action: string, target?: string, detail?: Record<string, unknown>) {
  await db.platformAuditLog.create({ data: { actorId: admin.id, actorEmail: admin.email, action, target, detail: detail as Prisma.InputJsonValue | undefined } }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Super-admin-only actions — every one re-checks requireSuperAdmin() itself
// (never trusts that the calling page already gated it), and every action
// that changes something material to a tenant writes a real AuditLog entry
// against that tenant, so there's an actual accountability trail if a tenant
// ever disputes "who suspended us and why" or "who changed our plan".
// ─────────────────────────────────────────────────────────────────────────────

export async function suspendTenantAction(tenantId: string, suspend: boolean) {
  const admin = await requireSuperAdmin();
  const tenant = await db.tenant.update({ where: { id: tenantId }, data: { status: suspend ? "suspended" : "active" } });
  await audit({
    tenantId, requestId: newRequestId(), actorType: "user", actorId: admin.id,
    action: suspend ? "admin.tenant_suspend" : "admin.tenant_activate",
    target: tenant.name, success: true, detail: { by: admin.email },
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
});

export async function updatePlanAction(_prev: unknown, formData: FormData) {
  const admin = await requireSuperAdmin();
  const raw = Object.fromEntries(formData.entries());
  const parsed = planSchema.safeParse({ ...raw, active: formData.get("active") === "on" });
  if (!parsed.success) return { error: "Check the plan values — all limits must be whole numbers." };
  const d = parsed.data;
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
  await auditPlatform(admin, "admin.plan_update", plan.name, { priceMonthly: d.priceMonthly });
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
  const admin = await requireSuperAdmin();
  const parsed = pricingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Prices/costs must be numbers (0 or more)." };
  for (const [key, value] of Object.entries(parsed.data)) {
    await setSetting(key as SettingKey, String(value));
  }
  await auditPlatform(admin, "admin.pricing_update", undefined, parsed.data);
  revalidatePath("/admin/billing");
  return { ok: true };
}

export async function updateAiProviderCostAction(_prev: unknown, formData: FormData) {
  const admin = await requireSuperAdmin();
  const provider = String(formData.get("provider") ?? "");
  const cost = Number(formData.get("costPerCallKes"));
  if (!provider || !Number.isFinite(cost) || cost < 0) return { error: "Enter a valid cost." };
  await setAiProviderCost(provider, cost);
  await auditPlatform(admin, "admin.ai_cost_update", provider, { costPerCallKes: cost });
  revalidatePath("/admin/ai");
  revalidatePath("/admin/billing");
  return { ok: true };
}

export async function setPrimaryProviderAction(provider: string) {
  const admin = await requireSuperAdmin();
  await setSetting("ai_primary_provider", provider);
  await auditPlatform(admin, "admin.ai_primary_provider_change", provider || "(auto)");
  revalidatePath("/admin/ai");
  return { ok: true };
}

export async function resetPricingDefaultsAction() {
  const admin = await requireSuperAdmin();
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    if (key === "ai_primary_provider") continue;
    await setSetting(key, String(SETTING_DEFAULTS[key]));
  }
  await auditPlatform(admin, "admin.pricing_reset_defaults");
  revalidatePath("/admin/billing");
  return { ok: true };
}

const modelPricingSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  inputPerMillionUsd: z.coerce.number().min(0),
  outputPerMillionUsd: z.coerce.number().min(0),
});

/** Pricing is VERSIONED — this always INSERTS a new row (effectiveFrom = now),
 *  never updates one in place, so historical cost calculations keep using
 *  whatever price was actually in effect at the time even after this changes. */
export async function addModelPricingAction(_prev: unknown, formData: FormData) {
  const admin = await requireSuperAdmin();
  const parsed = modelPricingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Enter a valid provider, model name, and prices (0 or more)." };
  const d = parsed.data;
  await db.modelPricing.create({ data: { ...d, setById: admin.id } });
  await auditPlatform(admin, "admin.model_pricing_set", `${d.provider}/${d.model}`, { inputPerMillionUsd: d.inputPerMillionUsd, outputPerMillionUsd: d.outputPerMillionUsd });
  revalidatePath("/admin/models");
  revalidatePath("/admin/billing");
  return { ok: true };
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

export async function changeAdminPasswordAction(_prev: unknown, formData: FormData) {
  const admin = await requireSuperAdmin();
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const user = await db.user.findUnique({ where: { id: admin.id } });
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return { error: "Current password is incorrect." };
  }
  await db.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword) } });
  return { ok: true, message: "Password updated." };
}
