"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { verifyPassword, hashPassword, createSession, destroySession, requireTenantUser, userPermissions, recordLoginAttempt } from "./auth";
import { encryptJSON, randomToken, sha256 } from "./crypto";
import { WEBHOOK_EVENTS } from "./webhooks";
import { PERMISSIONS, DEFAULT_USER_ROLES, DEFAULT_CONTACT_ROLES } from "./permissions";
import { computeBill } from "./billing";
import { stkPush, isConfigured, classifyMpesaFailure } from "./mpesa";
import { storeProductImage } from "./documents";
import { normalizePhone } from "./conversation";
import { handleSubscriptionPaymentConfirmed } from "./billing-lifecycle";
import { assertChannelEnabled } from "./payment-channels";
import type { ParamSpec } from "./connector-engine";
import { getSettingNumber } from "./platform-settings";

/** Real brute-force protection — LoginAttempt was already logged for every
 *  try but never actually consulted before this; a fixed number of recent
 *  failures for the SAME email (not IP — a shared/NAT'd IP shouldn't lock
 *  out unrelated accounts) blocks further attempts for a rolling window,
 *  regardless of whether the email even exists (never leaks that). */
export async function loginAction(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");

  const [maxAttempts, windowMinutes] = await Promise.all([
    getSettingNumber("login_lockout_max_attempts"),
    getSettingNumber("login_lockout_window_minutes"),
  ]);
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const recentFailures = await db.loginAttempt.count({ where: { email, success: false, createdAt: { gte: since } } });
  if (recentFailures >= maxAttempts) {
    return { error: `Too many failed attempts. Try again in a few minutes.` };
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await recordLoginAttempt(email, false);
    return { error: "Invalid email or password." };
  }
  await recordLoginAttempt(email, true);
  await createSession(user.id, user.tenantId, user.isSuperAdmin);
  redirect(user.isSuperAdmin || user.adminRoleId ? "/admin" : "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

// ── Billing: real M-Pesa Daraja STK push ──────────────────────────────────────
// Sends a "pay" prompt to the customer's phone. If Daraja isn't configured, we
// fall back to an instant mock so the demo still works.
const paySchema = z.object({ phone: z.string().min(9), amount: z.coerce.number().int().positive() });

const autoRenewSchema = z.object({ billingPhone: z.string().min(9).optional().or(z.literal("")), autoRenew: z.coerce.boolean().optional() });

/** Lets a tenant set the number automated renewal charges should target, and
 *  opt in/out of auto-renewal — the billing lifecycle engine (see
 *  billing-lifecycle.ts) NEVER invents or guesses this number; it only
 *  attempts an automated charge when the tenant has explicitly set one here. */
export async function updateAutoRenewAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.BILLING_MANAGE)) return { error: "You don't have billing permission." };
  const parsed = autoRenewSchema.safeParse({ billingPhone: formData.get("billingPhone"), autoRenew: formData.get("autoRenew") === "on" });
  if (!parsed.success) return { error: "Enter a valid phone number, or leave it blank to disable auto-renewal." };
  await db.subscription.update({
    where: { tenantId: user.tenantId! },
    data: { billingPhone: parsed.data.billingPhone || null, autoRenew: !!parsed.data.autoRenew && !!parsed.data.billingPhone },
  });
  revalidatePath("/dashboard/billing");
  return { ok: true };
}

export async function startPaymentAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.BILLING_MANAGE)) return { error: "You don't have billing permission." };
  const parsed = paySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Enter a valid M-Pesa phone number." };
  const { phone, amount } = parsed.data;
  const reference = "PAY-" + randomToken(4).toUpperCase();
  const period = new Date().toISOString().slice(0, 7);

  const channelCheck = await assertChannelEnabled("mpesa_stk");
  if (!channelCheck.ok) return { error: channelCheck.error };

  if (!isConfigured()) {
    const payment = await db.payment.create({ data: { tenantId: user.tenantId!, reference, amount, currency: "KES", purpose: "subscription", method: "mpesa", channelKey: "mpesa_stk", status: "paid", provider: "mock", periodLabel: period, paidAt: new Date() } });
    // Mock mode still drives the REAL billing lifecycle (renewsAt extension,
    // reactivation, receipt generation) — only the payment gateway call
    // itself is mocked, nothing about what happens after "paid" is faked.
    await handleSubscriptionPaymentConfirmed({ id: payment.id, tenantId: payment.tenantId, reference: payment.reference, amount: payment.amount, currency: payment.currency, method: payment.method, periodLabel: payment.periodLabel }).catch(() => {});
    revalidatePath("/dashboard/billing");
    return { ok: true, ref: reference, mock: true, message: "Recorded (demo mode — set M-Pesa keys in .env for a real STK push)." };
  }

  await db.payment.create({ data: { tenantId: user.tenantId!, reference, amount, currency: "KES", purpose: "subscription", method: "mpesa", channelKey: "mpesa_stk", status: "pending", provider: "daraja", periodLabel: period } });
  const res = await stkPush({ phone, amount, accountRef: reference, description: "P2Less bill" });
  if (!res.ok) {
    await db.payment.updateMany({ where: { reference }, data: { status: "failed", failureCategory: classifyMpesaFailure(res.error), failureReason: res.error.slice(0, 300) } });
    return { error: res.error, ref: reference };
  }
  await db.payment.updateMany({ where: { reference }, data: { providerRef: res.checkoutId } });
  return { ok: true, ref: reference, checkoutId: res.checkoutId, message: res.customerMessage };
}

// ── Self-serve onboarding (Embedded-Signup style) ─────────────────────────────
// Provisions a tenant + number WITHOUT the org touching the Meta dashboard. In
// production the WhatsApp number + WABA + token come back from Meta's Embedded
// Signup popup; here we provision the tenant and mark the number pending, with
// that Meta step stubbed (see /onboard and docs/ARCHITECTURE for the real hook).
const provisionSchema = z.object({
  orgName: z.string().min(2),
  industry: z.enum(["school", "hospital", "business", "sacco", "ngo", "government"]),
  phoneNumber: z.string().min(7),
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
});

export async function provisionOrganizationAction(_prev: unknown, formData: FormData) {
  const parsed = provisionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  if (await db.user.findUnique({ where: { email: d.adminEmail } })) {
    return { error: "That email already has an account. Try signing in." };
  }
  if (await db.whatsAppNumber.findUnique({ where: { phoneNumber: d.phoneNumber } })) {
    return { error: "That phone number is already registered on P2Less. Use a different number, or contact us if this is yours." };
  }
  const slug = d.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) + "-" + randomToken(2).toLowerCase();

  // Everything below must succeed together — a partial failure (e.g. a phone
  // number collision slipping past the check above under a race) must not leave
  // an orphaned tenant/roles/owner with no WhatsApp number. One transaction.
  try {
    const { password } = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: d.orgName, slug, industry: d.industry, status: "trial", branding: { assistantName: d.orgName, poweredBy: "Powered by P2Less" } },
      });
      const freePlan = (await tx.plan.findUnique({ where: { key: "free" } })) ?? (await tx.plan.findFirst({ orderBy: { sort: "asc" } }));
      if (freePlan) await tx.subscription.create({ data: { tenantId: tenant.id, planId: freePlan.id, period: "monthly", status: "trial", renewsAt: new Date(Date.now() + 30 * 864e5) } });

      // Roles (staff + contacts) so the org can operate immediately.
      let ownerRoleId = "";
      for (const r of DEFAULT_USER_ROLES) {
        const role = await tx.role.create({ data: { tenantId: tenant.id, key: r.key, name: r.name, isSystem: r.isSystem, permissions: r.permissions } });
        if (r.key === "owner") ownerRoleId = role.id;
      }
      for (const r of DEFAULT_CONTACT_ROLES) {
        await tx.role.create({ data: { tenantId: tenant.id, key: r.key, name: r.name, isSystem: r.isSystem, permissions: r.permissions } });
      }

      // Owner login (one-time password shown to the user).
      const password = randomToken(6);
      const owner = await tx.user.create({ data: { tenantId: tenant.id, name: d.adminName, email: d.adminEmail, passwordHash: await hashPassword(password) } });
      if (ownerRoleId) await tx.userRole.create({ data: { userId: owner.id, roleId: ownerRoleId } });

      // The organization's WhatsApp number. In production this arrives from Meta's
      // Embedded Signup (WABA id + phone_number_id + token); here it's pending.
      await tx.whatsAppNumber.create({
        data: { tenantId: tenant.id, phoneNumber: d.phoneNumber, displayName: d.orgName, department: "General", status: "active", verificationStatus: "pending" },
      });

      return { password };
    });
    return { ok: true, email: d.adminEmail, password, slug };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That phone number or email is already in use. Please try different details." };
    }
    console.error("[provisionOrganizationAction] failed:", e);
    return { error: "Something went wrong setting up your organization. Please try again." };
  }
}

// ── Developer platform: API keys + webhooks ───────────────────────────────────
const DEFAULT_SCOPES = ["conversations.read", "numbers.read", "capabilities.read", "usage.read", "messages.write", "webhooks.write"];

export async function createApiKeyAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return { error: "You don't have developer permission." };
  const name = String(formData.get("name") ?? "").trim() || "Default key";
  const full = "p2l_" + randomToken(30);
  await db.apiKey.create({
    data: { tenantId: user.tenantId!, name, prefix: full.slice(0, 14), keyHash: sha256(full), scopes: DEFAULT_SCOPES },
  });
  revalidatePath("/dashboard/developers");
  // The full key is shown ONCE — it is not recoverable afterwards.
  return { ok: true, key: full };
}

export async function revokeApiKeyAction(formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return;
  await db.apiKey.updateMany({ where: { id: String(formData.get("id")), tenantId: user.tenantId! }, data: { revokedAt: new Date() } });
  revalidatePath("/dashboard/developers");
}

export async function addWebhookAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return { error: "You don't have developer permission." };
  const url = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\/.+/.test(url)) return { error: "Enter a valid https URL." };
  const events = formData.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (events.length === 0) return { error: "Select at least one event." };
  const secret = "whsec_" + randomToken(16);
  await db.webhook.create({ data: { tenantId: user.tenantId!, url, secret, events, active: true } });
  revalidatePath("/dashboard/developers");
  return { ok: true, secret };
}

export async function deleteWebhookAction(formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return;
  await db.webhook.deleteMany({ where: { id: String(formData.get("id")), tenantId: user.tenantId! } });
  revalidatePath("/dashboard/developers");
}

// ── Assistant FAQs — org-approved answers the AI may give verbatim ──────────
export async function saveFaqsAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE)) return { error: "You don't have permission to edit organization settings." };
  let parsed: { q?: unknown; a?: unknown }[] = [];
  try {
    parsed = JSON.parse(String(formData.get("faqs") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("not an array");
  } catch {
    return { error: "Couldn't read the FAQ list — please try again." };
  }
  // Keep only complete Q&A pairs; trim, cap length and count so the prompt stays sane.
  const clean = parsed
    .map((f) => ({ q: String(f.q ?? "").trim().slice(0, 200), a: String(f.a ?? "").trim().slice(0, 600) }))
    .filter((f) => f.q && f.a)
    .slice(0, 40);
  await db.tenant.update({ where: { id: user.tenantId! }, data: { faqs: clean as object } });
  revalidatePath("/dashboard/faqs");
  return { ok: true, count: clean.length };
}

// ── Business catalog — products a tenant sells, browsable/orderable on WhatsApp ─
const productSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(""),
  price: z.coerce.number().int().positive(),
  currency: z.string().min(3).max(3).optional().default("KES"),
  category: z.string().max(60).optional().default(""),
  sku: z.string().max(60).optional().default(""),
  options: z.string().max(200).optional().default(""),
  stockQuantity: z.string().optional().default(""), // blank = not tracked; parsed manually below (z.coerce.number would turn "" into 0)
  inStock: z.coerce.boolean().optional().default(true),
});

const IMAGE_MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — plenty for a product photo, keeps the DB blob small

// One action for both create and edit — presence of "id" decides which. Keeps
// the client form simple (a single useActionState, no hook-swapping on edit).
export async function saveProductAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.PRODUCTS_MANAGE)) return { error: "You don't have permission to manage products." };
  const parsed = productSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid product details." };
  const d = parsed.data;
  const id = String(formData.get("id") ?? "");
  const stockRaw = d.stockQuantity.trim();
  if (stockRaw && (!/^\d+$/.test(stockRaw) || parseInt(stockRaw, 10) < 0)) return { error: "Stock quantity must be a whole number, or blank to not track it." };
  const data: { name: string; description: string | null; price: number; currency: string; category: string | null; sku: string | null; options: string | null; stockQuantity: number | null; inStock: boolean; imageUrl?: string } = {
    name: d.name, description: d.description || null, price: d.price, currency: d.currency, category: d.category || null, sku: d.sku || null, options: d.options || null,
    stockQuantity: stockRaw ? parseInt(stockRaw, 10) : null, inStock: d.inStock,
  };

  // A new photo is optional — an empty file input submits a zero-byte File, and
  // editing without touching the photo must NOT clear the existing one.
  const imageFile = formData.get("image");
  if (imageFile instanceof File && imageFile.size > 0) {
    if (imageFile.size > MAX_IMAGE_BYTES) return { error: "Image is too large (max 5MB)." };
    const ext = IMAGE_MIME_EXT[imageFile.type];
    if (!ext) return { error: "Image must be JPEG, PNG, WEBP or GIF." };
    const buf = Buffer.from(await imageFile.arrayBuffer());
    const stored = await storeProductImage({ tenantId: user.tenantId!, filename: `product-${randomToken(4)}.${ext}`, base64: buf.toString("base64") });
    data.imageUrl = stored.url;
  }

  if (id) {
    await db.product.updateMany({ where: { id, tenantId: user.tenantId! }, data });
  } else {
    await db.product.create({ data: { tenantId: user.tenantId!, ...data } });
  }
  revalidatePath("/dashboard/products");
  return { ok: true, editedId: id || undefined };
}

// Toggle, not delete — past orders reference products, so we never hard-delete;
// disabling just hides it from the WhatsApp catalog and blocks new orders.
export async function toggleProductActiveAction(formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.PRODUCTS_MANAGE)) return;
  const id = String(formData.get("id") ?? "");
  const product = await db.product.findFirst({ where: { id, tenantId: user.tenantId! } });
  if (!product) return;
  await db.product.update({ where: { id }, data: { active: !product.active } });
  revalidatePath("/dashboard/products");
}

// ── Delivery zones — manual pricing tiers the assistant matches a customer's
// address against ("Within Nairobi CBD" = KES 200) since no Maps/geocoding API
// is wired in yet ─────────────────────────────────────────────────────────────
const deliveryZoneSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(300).optional().default(""),
  fee: z.coerce.number().int().min(0),
});

export async function saveDeliveryZoneAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.DELIVERY_MANAGE)) return { error: "You don't have permission to manage delivery zones." };
  const parsed = deliveryZoneSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid delivery zone details." };
  const d = parsed.data;
  const id = String(formData.get("id") ?? "");
  const data = { name: d.name, description: d.description || null, fee: d.fee };
  if (id) {
    await db.deliveryZone.updateMany({ where: { id, tenantId: user.tenantId! }, data });
  } else {
    await db.deliveryZone.create({ data: { tenantId: user.tenantId!, ...data } });
  }
  revalidatePath("/dashboard/delivery");
  return { ok: true, editedId: id || undefined };
}

export async function toggleDeliveryZoneActiveAction(formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.DELIVERY_MANAGE)) return;
  const id = String(formData.get("id") ?? "");
  const zone = await db.deliveryZone.findFirst({ where: { id, tenantId: user.tenantId! } });
  if (!zone) return;
  await db.deliveryZone.update({ where: { id }, data: { active: !zone.active } });
  revalidatePath("/dashboard/delivery");
}

// ── Drivers — the business's own delivery roster. Availability is set by the
// driver conversationally (see conversation.ts handleDriverMessage), NOT typed
// in here by the owner — only identity (name, phone) is dashboard-managed ────
const driverSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(7).max(20),
});

export async function saveDriverAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.DRIVERS_MANAGE)) return { error: "You don't have permission to manage drivers." };
  const parsed = driverSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid driver details." };
  const d = parsed.data;
  const id = String(formData.get("id") ?? "");
  const phone = normalizePhone(d.phone);
  const data = { name: d.name, phone };
  if (id) {
    await db.driver.updateMany({ where: { id, tenantId: user.tenantId! }, data });
  } else {
    const existing = await db.driver.findFirst({ where: { tenantId: user.tenantId!, phone } });
    if (existing) return { error: "A driver with this phone number already exists." };
    await db.driver.create({ data: { tenantId: user.tenantId!, ...data } });
  }
  revalidatePath("/dashboard/drivers");
  return { ok: true, editedId: id || undefined };
}

export async function toggleDriverActiveAction(formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.DRIVERS_MANAGE)) return;
  const id = String(formData.get("id") ?? "");
  const driver = await db.driver.findFirst({ where: { id, tenantId: user.tenantId! } });
  if (!driver) return;
  await db.driver.update({ where: { id }, data: { active: !driver.active } });
  revalidatePath("/dashboard/drivers");
}

// ── Connector Builder ─────────────────────────────────────────────────────────
// Creates a connector + one action from the no-code form. Credentials are
// encrypted before storage. This is the same machinery used at runtime — there
// is no separate "real" path.

const connectorSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  baseUrl: z.string().url(),
  authType: z.enum(["none", "api_key", "bearer", "basic"]),
  apiKeyHeader: z.string().optional(),
  apiKeyValue: z.string().optional(),
  bearerToken: z.string().optional(),
  basicUser: z.string().optional(),
  basicPass: z.string().optional(),
  // first action
  actionKey: z.string().min(1),
  actionName: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1),
  requiredPermission: z.string().optional(),
  requiresStepUp: z.string().optional(),
  samplePhrases: z.string().optional(),
  replyTemplate: z.string().optional(),
});

export async function createConnectorAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.CONNECTORS_MANAGE)) {
    return { error: "You don't have permission to manage connectors." };
  }
  const raw = Object.fromEntries(formData.entries());
  const parsed = connectorSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  let authConfig: unknown = { type: "none" };
  if (d.authType === "api_key") authConfig = { type: "api_key", header: d.apiKeyHeader || "x-api-key", value: d.apiKeyValue || "" };
  else if (d.authType === "bearer") authConfig = { type: "bearer", token: d.bearerToken || "" };
  else if (d.authType === "basic") authConfig = { type: "basic", username: d.basicUser || "", password: d.basicPass || "" };

  // Derive a naive param schema from {placeholders} in the path.
  const pathParams = [...d.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const paramSchema: ParamSpec[] = pathParams.map((name) => ({
    name, in: "path", required: true, from: name === "studentId" ? "entity" : "const", entity: name,
  }));

  await db.connector.create({
    data: {
      tenantId: user.tenantId!,
      name: d.name,
      description: d.description,
      baseUrl: d.baseUrl,
      authType: d.authType,
      authConfigEnc: encryptJSON(authConfig),
      actions: {
        create: {
          key: d.actionKey.toUpperCase().replace(/\s+/g, "_"),
          name: d.actionName,
          method: d.method,
          path: d.path,
          paramSchema: paramSchema as unknown as object,
          requiredPermission: d.requiredPermission || null,
          resourceGrantKey: pathParams.includes("studentId") ? "students" : null,
          resourceParam: pathParams.includes("studentId") ? "studentId" : null,
          requiresStepUp: d.requiresStepUp === "on",
          samplePhrases: (d.samplePhrases ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
          replyTemplate: d.replyTemplate || null,
        },
      },
    },
  });
  revalidatePath("/dashboard/connectors");
  redirect("/dashboard/connectors");
}
