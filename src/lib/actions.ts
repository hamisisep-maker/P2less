"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { verifyPassword, hashPassword, createSession, destroySession, requireTenantUser, userPermissions } from "./auth";
import { encryptJSON, randomToken, sha256 } from "./crypto";
import { WEBHOOK_EVENTS } from "./webhooks";
import { PERMISSIONS, DEFAULT_USER_ROLES, DEFAULT_CONTACT_ROLES } from "./permissions";
import { computeBill } from "./billing";
import { stkPush, isConfigured } from "./mpesa";
import type { ParamSpec } from "./connector-engine";

export async function loginAction(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Invalid email or password." };
  }
  await createSession(user.id, user.tenantId, user.isSuperAdmin);
  redirect(user.isSuperAdmin ? "/admin" : "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

// ── Billing: real M-Pesa Daraja STK push ──────────────────────────────────────
// Sends a "pay" prompt to the customer's phone. If Daraja isn't configured, we
// fall back to an instant mock so the demo still works.
const paySchema = z.object({ phone: z.string().min(9), amount: z.coerce.number().int().positive() });

export async function startPaymentAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.BILLING_MANAGE)) return { error: "You don't have billing permission." };
  const parsed = paySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Enter a valid M-Pesa phone number." };
  const { phone, amount } = parsed.data;
  const reference = "PAY-" + randomToken(4).toUpperCase();
  const period = new Date().toISOString().slice(0, 7);

  if (!isConfigured()) {
    await db.payment.create({ data: { tenantId: user.tenantId!, reference, amount, currency: "KES", purpose: "subscription", method: "mpesa", status: "paid", provider: "mock", periodLabel: period, paidAt: new Date() } });
    revalidatePath("/dashboard/billing");
    return { ok: true, ref: reference, mock: true, message: "Recorded (demo mode — set M-Pesa keys in .env for a real STK push)." };
  }

  await db.payment.create({ data: { tenantId: user.tenantId!, reference, amount, currency: "KES", purpose: "subscription", method: "mpesa", status: "pending", provider: "daraja", periodLabel: period } });
  const res = await stkPush({ phone, amount, accountRef: reference, description: "P2Less bill" });
  if (!res.ok) {
    await db.payment.updateMany({ where: { reference }, data: { status: "failed" } });
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
  inStock: z.coerce.boolean().optional().default(true),
});

// One action for both create and edit — presence of "id" decides which. Keeps
// the client form simple (a single useActionState, no hook-swapping on edit).
export async function saveProductAction(_prev: unknown, formData: FormData) {
  const user = await requireTenantUser();
  if (!userPermissions(user).includes(PERMISSIONS.PRODUCTS_MANAGE)) return { error: "You don't have permission to manage products." };
  const parsed = productSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid product details." };
  const d = parsed.data;
  const id = String(formData.get("id") ?? "");
  const data = { name: d.name, description: d.description || null, price: d.price, currency: d.currency, category: d.category || null, sku: d.sku || null, inStock: d.inStock };
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
