"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { verifyPassword, hashPassword, createSession, destroySession, withTenantUser, userPermissions, recordLoginAttempt, clientMeta } from "./auth";
import { runCrossTenant } from "./tenant-context";
import { encryptJSON, randomToken, sha256 } from "./crypto";
import { rateLimit } from "./rate-limit";
import { WEBHOOK_EVENTS } from "./webhooks";
import { PERMISSIONS, DEFAULT_USER_ROLES, DEFAULT_CONTACT_ROLES } from "./permissions";
import { stkPush, isConfigured, classifyMpesaFailure } from "./mpesa";
import { storeProductImage } from "./documents";
import { normalizePhone } from "./conversation";
import { handleSubscriptionPaymentConfirmed } from "./billing-lifecycle";
import { assertChannelEnabled } from "./payment-channels";
import type { ParamSpec } from "./connector-engine";
import { getSetting, getSettingNumber } from "./platform-settings";
import { crawlSite } from "./website-crawl";
import { extractFaqDraft } from "./ai";
import { issuePhoneOtp, verifyPhoneOtp, countRecentCompletedSignupsFromIp } from "./otp";
import { sendSms, smsEnabled } from "./sms";
import { queueNotification } from "./notifications";
import { buildEmbeddedSignupLink } from "./whatsapp-embedded-signup";
import { buildMessengerConnectLink } from "./messenger";
import { connectTelegramBot } from "./telegram";
import { activateEmailChannel } from "./email-channel";
import { autoPublishProduct, setAutoPublishEnabled } from "./social-publish";
import {
  isConfigured as stripeIsConfigured, publishableKey, createSetupIntent, verifySetupIntentSucceeded, createCustomerWithCard,
} from "./stripe";

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

  // Deliberately cross-tenant — this IS the lookup that resolves who's
  // logging in and which tenant (if any) they belong to; nothing can be
  // scoped yet. Found in the same 2026-08-23 fail-closed audit as every
  // other identity-resolution lookup — this one is the most critical, since
  // it broke login itself in production.
  const user = await runCrossTenant(() => db.user.findUnique({ where: { email } }));
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
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.BILLING_MANAGE)) return { error: "You don't have billing permission." };
    const parsed = autoRenewSchema.safeParse({ billingPhone: formData.get("billingPhone"), autoRenew: formData.get("autoRenew") === "on" });
    if (!parsed.success) return { error: "Enter a valid phone number, or leave it blank to disable auto-renewal." };
    await db.subscription.update({
      where: { tenantId: user.tenantId! },
      data: { billingPhone: parsed.data.billingPhone || null, autoRenew: !!parsed.data.autoRenew && !!parsed.data.billingPhone },
    });
    revalidatePath("/dashboard/billing");
    return { ok: true };
  });
}

export async function startPaymentAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
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
  });
}

/** Tenant self-service — UPGRADE only, enforced server-side (never trust a
 *  client-submitted planId's direction). Applies immediately: an explicit,
 *  honest "the whole current month bills at the new plan's rate, no
 *  partial-month credit" rule, safe because it only ever increases what's
 *  charged. Downgrades are deliberately NOT self-service — direct user
 *  decision, see admin-actions.ts's changeTenantPlanAction for why (real
 *  gaming risk: changing plan right before the bill is computed could
 *  otherwise shrink what's owed for usage already incurred at the higher
 *  rate). Direction is read from Plan.sort, not priceMonthly — checked the
 *  real seed data first: Enterprise prices at 0, same as Free, but is
 *  obviously the top tier. */
export async function upgradeSubscriptionPlanAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.BILLING_MANAGE)) return { error: "You don't have billing permission." };
    const tenantId = user.tenantId!;
    const newPlanId = String(formData.get("planId") ?? "");
    const [sub, newPlan] = await Promise.all([
      db.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      db.plan.findUnique({ where: { id: newPlanId } }),
    ]);
    if (!sub) return { error: "No subscription found." };
    if (!newPlan || !newPlan.active) return { error: "That plan isn't available." };
    if (newPlan.sort <= sub.plan.sort) return { error: "Downgrading isn't self-service — contact us and we'll take care of it." };

    await db.subscription.update({ where: { tenantId }, data: { planId: newPlan.id, pendingPlanId: null } });
    const { audit } = await import("./audit");
    const { requestId: newRequestId } = await import("./crypto");
    await audit({
      tenantId, requestId: newRequestId(), actorType: "user", actorId: user.id,
      action: "subscription.plan_upgraded", target: newPlan.id, success: true,
      detail: { fromPlan: sub.plan.name, toPlan: newPlan.name },
    });
    revalidatePath("/dashboard/billing");
    return { ok: true, planName: newPlan.name };
  });
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
  // Registration reframe: what the org said they want P2Less to do,
  // collected alongside industry. CONTEXT, not a hard gate — same honest
  // role industry already plays (nothing branches on either to restrict
  // features). Empty is fine (nothing checked / JS disabled).
  useCases: z.array(z.string()).default([]),
  // Registration reframe, continued: WHICH channels the org's own
  // customers actually use — a distinct question from "what do you want
  // P2Less to do" (proposal's step 2, "which channels do your users
  // need?"). Same honest, context-not-gate role as useCases/industry —
  // captures real demand signal for channels not built yet (SMS, Instagram)
  // without pretending they're active.
  channelsNeeded: z.array(z.string()).default([]),
});

// FormData collapses repeated same-named fields (checkboxes, or the hidden-
// input round-trip between /onboard's steps) down to just the last value via
// Object.fromEntries — this restores the array shape for these specific
// fields before handing off to Zod, everywhere a step's incoming fields get
// parsed.
const ARRAY_FIELDS = ["useCases", "channelsNeeded"] as const;
function formDataWithArrays(formData: FormData): Record<string, unknown> {
  const base: Record<string, unknown> = Object.fromEntries(formData.entries());
  for (const field of ARRAY_FIELDS) base[field] = formData.getAll(field).map(String);
  return base;
}

// Closes the most common free-trial-abuse trick: Gmail ignores dots in the
// local part and treats anything after "+" as a tag, so you@gmail.com /
// you.x@gmail.com / you+1@gmail.com all reach the SAME real inbox but pass a
// raw-string uniqueness check as "different" accounts. Dots are only
// meaningless on Gmail specifically (most other providers treat them as
// real characters) — but "+tag" stripping is a near-universal convention
// supported by Outlook, Yahoo, and most custom-domain mail setups, so it's
// safe to apply generally.
function canonicalizeEmail(raw: string): string {
  const trimmed = raw.toLowerCase().trim();
  const at = trimmed.lastIndexOf("@");
  if (at === -1) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const noPlus = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${noPlus.replace(/\./g, "")}@gmail.com`;
  }
  return `${noPlus}@${domain}`;
}

/** Shared validation for both steps: rate limit + field shape + the three
 *  uniqueness checks. Step 1 uses this to decide whether to send an OTP at
 *  all; step 2 re-runs it defensively right before actually creating the
 *  tenant, since real time (and a real race with someone else signing up)
 *  passes between the two form submissions. */
async function validateOnboardFields(formData: FormData): Promise<{ error: string } | { data: z.infer<typeof provisionSchema>; emailCanonical: string }> {
  const { ip } = await clientMeta();
  const limit = rateLimit(`onboard:${ip ?? "unknown"}`, { max: 3, windowMs: 60 * 60_000 });
  if (!limit.ok) {
    return { error: "Too many signup attempts from this connection. Please try again later, or contact us if you need help getting started." };
  }
  const parsed = provisionSchema.safeParse(formDataWithArrays(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const emailCanonical = canonicalizeEmail(d.adminEmail);

  // Deliberately cross-tenant — these are global uniqueness pre-checks
  // before any tenant exists to create context from. Found in the same
  // 2026-08-23 fail-closed audit as every other pre-context lookup.
  const clash = await runCrossTenant(async () => {
    if (await db.user.findUnique({ where: { email: d.adminEmail } })) return "email";
    if (await db.user.findUnique({ where: { emailCanonical } })) return "emailCanonical";
    if (await db.whatsAppNumber.findUnique({ where: { phoneNumber: d.phoneNumber } })) return "phone";
    return null;
  });
  if (clash === "email") return { error: "That email already has an account. Try signing in." };
  if (clash === "emailCanonical") return { error: "That email already has an account (even if it looks slightly different — dots and +tags on the same inbox count as one account). Try signing in, or contact us if this isn't yours." };
  if (clash === "phone") return { error: "That phone number is already registered on P2Less. Use a different number, or contact us if this is yours." };
  return { data: d, emailCanonical };
}

/** Step 1: validate the signup form, then verify the org actually controls
 *  the phone number before creating anything — closes the trial-abuse gap
 *  where a fake/sequential number could pass the old plain uniqueness check.
 *  Sends via sendSms() (Advanta primary, Africa's Talking fallback); if
 *  neither is configured, echoes the code directly with an honest "Demo
 *  only" label — same convention already used for webchat's own OTP flow
 *  when there's no real out-of-band channel to prove against. */
export type RequestOtpResult =
  | ({ ok: true; step: "otp"; challengeId: string; demoCode?: string } & OtpStepFields)
  | { error: string };

export async function requestOnboardOtpAction(_prev: unknown, formData: FormData): Promise<RequestOtpResult> {
  // The actual off switch (src/lib/maintenance-actions.ts's
  // setPublicRegistrationEnabledAction) — checked first, before any OTP is
  // issued or SMS sent, so a direct call to this action is blocked exactly
  // like the UI, not just visually hidden.
  const registrationEnabled = await getSetting("public_registration_enabled");
  if (registrationEnabled !== "1") {
    return { error: "New signups are currently paused. If you were invited, contact whoever sent you the link — otherwise check back soon." };
  }
  const validated = await validateOnboardFields(formData);
  if ("error" in validated) return { error: validated.error };
  const { data: d } = validated;

  const phone = normalizePhone(d.phoneNumber);
  const { ip } = await clientMeta();
  const issued = await issuePhoneOtp(phone, ip);
  if ("error" in issued) return { error: issued.error };

  const message = `Your P2Less verification code is ${issued.code}. It expires in 5 minutes.`;
  let demoCode: string | undefined;
  if (smsEnabled()) {
    const sent = await sendSms(phone, message);
    if (!sent.ok) {
      console.error(`[onboard] SMS send failed for challenge ${issued.challengeId}: ${sent.error}`);
      return { error: "We couldn't send a verification code to that number right now. Please check the number and try again, or contact us for help." };
    }
  } else {
    // No real SMS credentials configured yet — same honesty convention as
    // webchat's OTP flow: show the code directly rather than pretending it
    // was texted, instead of silently failing.
    demoCode = issued.code;
  }

  return {
    ok: true, step: "otp" as const, challengeId: issued.challengeId, demoCode,
    orgName: d.orgName, industry: d.industry, phoneNumber: d.phoneNumber, adminName: d.adminName, adminEmail: d.adminEmail, useCases: d.useCases, channelsNeeded: d.channelsNeeded,
  };
}

const confirmOtpSchema = provisionSchema.extend({ challengeId: z.string().min(1), code: z.string().min(1) });

type OtpStepFields = { orgName: string; industry: z.infer<typeof provisionSchema>["industry"]; phoneNumber: string; adminName: string; adminEmail: string; useCases: string[]; channelsNeeded: string[] };
type FinalizeOk = { ok: true; email: string; password: string; slug: string };

/** The actual tenant-creation transaction, shared by both the no-card-step
 *  path (Stripe unconfigured) and confirmOnboardCardAction. Identical to
 *  what confirmOnboardOtpAction used to do inline before the card step was
 *  inserted between phone verification and tenant creation. */
async function finalizeOnboarding(
  d: z.infer<typeof provisionSchema>,
  emailCanonical: string,
  card?: { customerId: string; paymentMethodId: string },
): Promise<FinalizeOk | { error: string }> {
  const slug = d.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) + "-" + randomToken(2).toLowerCase();

  // Everything below must succeed together — a partial failure (e.g. a phone
  // number collision slipping past the check above under a race) must not leave
  // an orphaned tenant/roles/owner with no WhatsApp number. One transaction.
  try {
    // Self-service signup creates a BRAND-NEW tenant's rows (Subscription,
    // Role, User, WhatsAppNumber, Channel — all tenant-scoped models) before
    // any tenant context could possibly exist to "enter" — there's no
    // pre-existing tenant yet. Found broken in production by the 2026-08-23
    // fail-closed rollout: every create below explicitly sets tenantId
    // itself already (safe), but the extension's context check ran before
    // ever looking at that. runCrossTenant is the correct marker here, same
    // as the public landing/demo pages — genuinely not scoped to an existing
    // single tenant at the point these writes happen.
    const { password } = await runCrossTenant(() => db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: d.orgName, slug, industry: d.industry, status: "trial",
          useCases: d.useCases.length > 0 ? d.useCases : undefined,
          channelsNeeded: d.channelsNeeded.length > 0 ? d.channelsNeeded : undefined,
          branding: { assistantName: d.orgName, poweredBy: "Powered by P2Less" },
          stripeCustomerId: card?.customerId, stripePaymentMethodId: card?.paymentMethodId,
        },
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
      const owner = await tx.user.create({ data: { tenantId: tenant.id, name: d.adminName, email: d.adminEmail, emailCanonical, passwordHash: await hashPassword(password) } });
      if (ownerRoleId) await tx.userRole.create({ data: { userId: owner.id, roleId: ownerRoleId } });

      // The organization's WhatsApp number. In production this arrives from Meta's
      // Embedded Signup (WABA id + phone_number_id + token); here it's pending —
      // phone ownership was already proven above via the OTP, though, unlike
      // before this phase.
      await tx.whatsAppNumber.create({
        data: { tenantId: tenant.id, phoneNumber: d.phoneNumber, displayName: d.orgName, department: "General", status: "active", verificationStatus: "pending" },
      });
      // The generic channel-resource record (see the Channel model's own
      // comment in schema.prisma) — a real, queryable "this tenant has a
      // whatsapp channel" row, kept in sync with WhatsAppNumber but not yet
      // read by anything else (no second real channel exists to make that
      // worth wiring — see the roadmap doc's "Registration reframe" section).
      await tx.channel.create({
        data: { tenantId: tenant.id, type: "whatsapp", address: d.phoneNumber, status: "active" },
      });

      return { password };
    }));

    // Real signup-clustering check — several DIFFERENT signups completing
    // from the same IP within a day is exactly the trial-abuse pattern
    // flagged earlier (see roadmap doc); queues a real admin notification
    // through the existing Notification Engine rather than a new delivery
    // mechanism. Never allowed to break the user's own success response.
    try {
      const { ip } = await clientMeta();
      if (ip) {
        const count = await countRecentCompletedSignupsFromIp(ip);
        if (count >= 3) {
          await queueNotification(
            "onboard_signup_anomaly",
            `${count} self-service signups completed from the same IP (${ip}) in the last 24 hours — most recently "${d.orgName}". Worth a quick look in case this is trial abuse rather than a legitimate agency/reseller signing up several clients.`,
          );
        }
      }
    } catch (e) {
      console.error("[finalizeOnboarding] anomaly check failed:", e);
    }

    return { ok: true, email: d.adminEmail, password, slug };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That phone number or email is already in use. Please try different details." };
    }
    console.error("[finalizeOnboarding] failed:", e);
    return { error: "Something went wrong setting up your organization. Please try again." };
  }
}

type CardStepFields = { setupIntentId: string; clientSecret: string; stripePublishableKey: string };
export type ConfirmOtpResult =
  | FinalizeOk
  | ({ ok: true; step: "card" } & CardStepFields & OtpStepFields)
  | ({ error: string; step: "otp"; challengeId: string } & OtpStepFields)
  | { error: string };

/** Step 2: verify the code, re-validate (defensive — real time passed since
 *  step 1), then either start card verification (step 3, if Stripe is
 *  configured) or create the tenant directly (Stripe unconfigured — the
 *  card-on-file deterrent degrades gracefully rather than blocking signup,
 *  same philosophy as every other optional provider in this codebase). */
export async function confirmOnboardOtpAction(_prev: unknown, formData: FormData): Promise<ConfirmOtpResult> {
  const parsed = confirmOtpSchema.safeParse(formDataWithArrays(formData));
  // A malformed resubmission (missing/corrupt hidden fields) has no org data
  // to hand back — can't stay on the OTP step honestly, so this falls back
  // to the start rather than pretending. Shouldn't happen via the real UI.
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { challengeId, code, ...rest } = parsed.data;

  const verified = await verifyPhoneOtp(challengeId, code);
  if (!verified.ok) {
    return { error: verified.message, step: "otp" as const, challengeId, ...rest };
  }

  const validated = await validateOnboardFields(formData);
  if ("error" in validated) return { error: validated.error };
  const { data: d, emailCanonical } = validated;

  if (!stripeIsConfigured()) {
    return finalizeOnboarding(d, emailCanonical);
  }
  const setupIntent = await createSetupIntent();
  if ("error" in setupIntent) return { error: setupIntent.error };
  return {
    ok: true, step: "card" as const, setupIntentId: setupIntent.setupIntentId, clientSecret: setupIntent.clientSecret, stripePublishableKey: publishableKey(),
    orgName: d.orgName, industry: d.industry, phoneNumber: d.phoneNumber, adminName: d.adminName, adminEmail: d.adminEmail, useCases: d.useCases, channelsNeeded: d.channelsNeeded,
  };
}

const confirmCardSchema = provisionSchema.extend({ setupIntentId: z.string().min(1) });
export type ConfirmCardResult =
  | FinalizeOk
  | ({ error: string; step: "card" } & CardStepFields & OtpStepFields)
  | { error: string };

/** Step 3 (only reached if Stripe is configured): re-verify the SetupIntent
 *  server-side — never trust the browser's own "it succeeded" claim alone —
 *  save the verified card against a real Stripe Customer, then create the
 *  tenant exactly as confirmOnboardOtpAction used to do directly. */
export async function confirmOnboardCardAction(_prev: unknown, formData: FormData): Promise<ConfirmCardResult> {
  const parsed = confirmCardSchema.safeParse(formDataWithArrays(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { setupIntentId, ...rest } = parsed.data;

  const verified = await verifySetupIntentSucceeded(setupIntentId);
  if (!verified.ok) {
    return { error: verified.error, step: "card" as const, setupIntentId, clientSecret: verified.clientSecret, stripePublishableKey: publishableKey(), ...rest };
  }

  const validated = await validateOnboardFields(formData);
  if ("error" in validated) return { error: validated.error };
  const { data: d, emailCanonical } = validated;

  const customer = await createCustomerWithCard(d.adminEmail, d.adminName, verified.paymentMethodId);
  if ("error" in customer) return { error: customer.error };

  return finalizeOnboarding(d, emailCanonical, { customerId: customer.customerId, paymentMethodId: verified.paymentMethodId });
}

// ── Developer platform: API keys + webhooks ───────────────────────────────────
const DEFAULT_SCOPES = ["conversations.read", "numbers.read", "capabilities.read", "usage.read", "messages.write", "webhooks.write"];

export async function createApiKeyAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return { error: "You don't have developer permission." };
    const name = String(formData.get("name") ?? "").trim() || "Default key";
    const full = "p2l_" + randomToken(30);
    await db.apiKey.create({
      data: { tenantId: user.tenantId!, name, prefix: full.slice(0, 14), keyHash: sha256(full), scopes: DEFAULT_SCOPES },
    });
    revalidatePath("/dashboard/developers");
    // The full key is shown ONCE — it is not recoverable afterwards.
    return { ok: true, key: full };
  });
}

export async function revokeApiKeyAction(formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return { error: "You don't have permission to manage API keys." };
    await db.apiKey.updateMany({ where: { id: String(formData.get("id")), tenantId: user.tenantId! }, data: { revokedAt: new Date() } });
    revalidatePath("/dashboard/developers");
    return { ok: true as const };
  });
}

// ── Universal Platform roadmap Phase 8e (2026-08-20): embeddable website
// chat widget key. Deliberately public (embedded in a <script> tag on the
// org's own site) — unlike ApiKey, never hashed, since there's nothing to
// keep secret; the origin allowlist + the widget route's rate limit are the
// actual protection. Parses the origins textarea leniently (comma or
// newline separated, trims, drops blanks) rather than requiring one format. ─
function parseOrigins(raw: string): string[] {
  return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

export async function createWidgetKeyAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return { error: "You don't have developer permission." };
    const origins = parseOrigins(String(formData.get("origins") ?? ""));
    const key = "wk_" + randomToken(20);
    await db.widgetKey.create({ data: { tenantId: user.tenantId!, key, allowedOrigins: origins } });
    revalidatePath("/dashboard/widget");
    return { ok: true, key };
  });
}

export async function updateWidgetOriginsAction(formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return { error: "You don't have permission to manage the widget." };
    const origins = parseOrigins(String(formData.get("origins") ?? ""));
    await db.widgetKey.updateMany({ where: { id: String(formData.get("id")), tenantId: user.tenantId! }, data: { allowedOrigins: origins } });
    revalidatePath("/dashboard/widget");
    return { ok: true as const };
  });
}

export async function deactivateWidgetKeyAction(formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return { error: "You don't have permission to manage the widget." };
    await db.widgetKey.updateMany({ where: { id: String(formData.get("id")), tenantId: user.tenantId! }, data: { active: false } });
    revalidatePath("/dashboard/widget");
    return { ok: true as const };
  });
}

export async function addWebhookAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return { error: "You don't have developer permission." };
    const url = String(formData.get("url") ?? "").trim();
    if (!/^https?:\/\/.+/.test(url)) return { error: "Enter a valid https URL." };
    const events = formData.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (events.length === 0) return { error: "Select at least one event." };
    const secret = "whsec_" + randomToken(16);
    await db.webhook.create({ data: { tenantId: user.tenantId!, url, secret, events, active: true } });
    revalidatePath("/dashboard/developers");
    return { ok: true, secret };
  });
}

export async function deleteWebhookAction(formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE)) return { error: "You don't have permission to manage webhooks." };
    await db.webhook.deleteMany({ where: { id: String(formData.get("id")), tenantId: user.tenantId! } });
    revalidatePath("/dashboard/developers");
    return { ok: true as const };
  });
}

// ── Assistant FAQs — org-approved answers the AI may give verbatim ──────────
export async function saveFaqsAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
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
    // "No changes made" detection, 2026-08-23 (Phase 4 of the UX audit) —
    // backend-authoritative per the standard: compare against what's actually
    // stored, not just what the client last loaded, before writing/revalidating.
    const tenant = await db.tenant.findUnique({ where: { id: user.tenantId! }, select: { faqs: true } });
    const current = (tenant?.faqs as { q: string; a: string }[] | null) ?? [];
    if (JSON.stringify(current) === JSON.stringify(clean)) {
      return { ok: true, count: clean.length, unchanged: true as const };
    }
    await db.tenant.update({ where: { id: user.tenantId! }, data: { faqs: clean as object } });
    revalidatePath("/dashboard/faqs");
    return { ok: true, count: clean.length };
  });
}

// Universal Platform roadmap Phase 8e (2026-08-21) — website content
// ingestion. Returns a DRAFT only, never writes to Tenant.faqs itself — the
// admin reviews/edits in the client, then saves through the existing
// saveFaqsAction above, same reviewable-draft discipline as OpenAPI import
// and the connector marketplace (Phases 6/7).
export async function crawlWebsiteAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE)) return { error: "You don't have permission to edit organization settings." };
    const url = String(formData.get("url") ?? "").trim();
    if (!url) return { error: "Enter a URL to scan." };
    const tenant = await db.tenant.findUnique({ where: { id: user.tenantId! } });
    let pages;
    try {
      pages = await crawlSite(url);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Couldn't reach that site." };
    }
    if (pages.length === 0) return { error: "Couldn't find any readable pages at that address." };
    let draft;
    try {
      draft = await extractFaqDraft(tenant?.name ?? "the organization", pages);
    } catch (e) {
      if (e instanceof Error && e.message === "AI_UNAVAILABLE") {
        return { error: `Scanned ${pages.length} page${pages.length === 1 ? "" : "s"} successfully, but our AI provider is temporarily busy and couldn't read through them just now — this isn't about your site, please try scanning again in a few minutes.` };
      }
      return { error: "Something went wrong reading the scanned pages — please try again." };
    }
    if (draft.length === 0) return { error: "Scanned the site but didn't find any clear FAQ-worthy content — try a more specific page (e.g. an FAQ or admissions page) or add entries manually." };
    return { ok: true, draft, pagesScanned: pages.length };
  });
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
  return withTenantUser(async (user) => {
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
      // "No changes made" detection, 2026-08-23 (Phase 4) — skip when a new
      // photo was uploaded (data.imageUrl set), since that's always a real,
      // intentional change regardless of the other fields.
      if (!("imageUrl" in data)) {
        const current = await db.product.findFirst({ where: { id, tenantId: user.tenantId! } });
        if (
          current &&
          current.name === data.name && current.description === data.description && current.price === data.price &&
          current.currency === data.currency && current.category === data.category && current.sku === data.sku &&
          current.options === data.options && current.stockQuantity === data.stockQuantity && current.inStock === data.inStock
        ) {
          return { ok: true, editedId: id, unchanged: true as const };
        }
      }
      await db.product.updateMany({ where: { id, tenantId: user.tenantId! }, data });
    } else {
      const created = await db.product.create({ data: { tenantId: user.tenantId!, ...data } });
      // Phase 8c — fire-and-forget, never blocks or fails the product creation
      // itself on a social-publish problem, same discipline as dispatchWebhook().
      // Only NEW products, matching the roadmap's own stated scope ("when a
      // product is uploaded... automatically publish it"), not every edit.
      void autoPublishProduct(user.tenantId!, created).catch(() => {});
    }
    revalidatePath("/dashboard/products");
    return { ok: true, editedId: id || undefined };
  });
}

// ── Auto-publish toggle (Phase 8c) ────────────────────────────────────────────
export async function setAutoPublishEnabledAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE)) {
      return { error: "Only an organization owner can change this." };
    }
    const enabled = formData.get("enabled") === "true";
    const result = await setAutoPublishEnabled(user.tenantId!, enabled);
    if (!result.ok) return { error: result.error };
    revalidatePath("/dashboard/channels");
    return { ok: true as const, warning: result.warning };
  });
}

// Toggle, not delete — past orders reference products, so we never hard-delete;
// disabling just hides it from the WhatsApp catalog and blocks new orders.
export async function toggleProductActiveAction(formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.PRODUCTS_MANAGE)) return { error: "You don't have permission to manage products." };
    const id = String(formData.get("id") ?? "");
    const product = await db.product.findFirst({ where: { id, tenantId: user.tenantId! } });
    if (!product) return { error: "Product not found." };
    const updated = await db.product.update({ where: { id }, data: { active: !product.active } });
    revalidatePath("/dashboard/products");
    return { ok: true as const, active: updated.active };
  });
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
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DELIVERY_MANAGE)) return { error: "You don't have permission to manage delivery zones." };
    const parsed = deliveryZoneSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid delivery zone details." };
    const d = parsed.data;
    const id = String(formData.get("id") ?? "");
    const data = { name: d.name, description: d.description || null, fee: d.fee };
    if (id) {
      // "No changes made" detection, 2026-08-23 (Phase 4).
      const current = await db.deliveryZone.findFirst({ where: { id, tenantId: user.tenantId! } });
      if (current && current.name === data.name && current.description === data.description && current.fee === data.fee) {
        return { ok: true, editedId: id, unchanged: true as const };
      }
      await db.deliveryZone.updateMany({ where: { id, tenantId: user.tenantId! }, data });
    } else {
      await db.deliveryZone.create({ data: { tenantId: user.tenantId!, ...data } });
    }
    revalidatePath("/dashboard/delivery");
    return { ok: true, editedId: id || undefined };
  });
}

export async function toggleDeliveryZoneActiveAction(formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DELIVERY_MANAGE)) return { error: "You don't have permission to manage delivery zones." };
    const id = String(formData.get("id") ?? "");
    const zone = await db.deliveryZone.findFirst({ where: { id, tenantId: user.tenantId! } });
    if (!zone) return { error: "Delivery zone not found." };
    const updated = await db.deliveryZone.update({ where: { id }, data: { active: !zone.active } });
    revalidatePath("/dashboard/delivery");
    return { ok: true as const, active: updated.active };
  });
}

// ── Drivers — the business's own delivery roster. Availability is set by the
// driver conversationally (see conversation.ts handleDriverMessage), NOT typed
// in here by the owner — only identity (name, phone) is dashboard-managed ────
const driverSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(7).max(20),
});

export async function saveDriverAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DRIVERS_MANAGE)) return { error: "You don't have permission to manage drivers." };
    const parsed = driverSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid driver details." };
    const d = parsed.data;
    const id = String(formData.get("id") ?? "");
    const phone = normalizePhone(d.phone);
    const data = { name: d.name, phone };
    if (id) {
      // "No changes made" detection, 2026-08-23 (Phase 4).
      const current = await db.driver.findFirst({ where: { id, tenantId: user.tenantId! } });
      if (current && current.name === data.name && current.phone === data.phone) {
        return { ok: true, editedId: id, unchanged: true as const };
      }
      await db.driver.updateMany({ where: { id, tenantId: user.tenantId! }, data });
    } else {
      const existing = await db.driver.findFirst({ where: { tenantId: user.tenantId!, phone } });
      if (existing) return { error: "A driver with this phone number already exists." };
      await db.driver.create({ data: { tenantId: user.tenantId!, ...data } });
    }
    revalidatePath("/dashboard/drivers");
    return { ok: true, editedId: id || undefined };
  });
}

export async function toggleDriverActiveAction(formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.DRIVERS_MANAGE)) return { error: "You don't have permission to manage drivers." };
    const id = String(formData.get("id") ?? "");
    const driver = await db.driver.findFirst({ where: { id, tenantId: user.tenantId! } });
    if (!driver) return { error: "Driver not found." };
    const updated = await db.driver.update({ where: { id }, data: { active: !driver.active } });
    revalidatePath("/dashboard/drivers");
    return { ok: true as const, active: updated.active };
  });
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
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.CONNECTORS_MANAGE)) {
      return { error: "You don't have permission to manage connectors." };
    }
    const raw = Object.fromEntries(formData.entries());
    const parsed = connectorSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
    const d = parsed.data;

    // SSRF guard (2026-08-23 stress-test review, #31): reject an unsafe
    // baseUrl at creation time too, for immediate feedback — the real
    // enforcement is at execution time (connector-engine.ts's safeFetch),
    // since DNS can change between now and every future call.
    const { assertSafeUrl, UnsafeUrlError } = await import("./ssrf-guard");
    try {
      await assertSafeUrl(d.baseUrl);
    } catch (e) {
      if (e instanceof UnsafeUrlError) return { error: e.message };
      throw e;
    }

    // Gap-002, fixed 2026-08-23 — same seat-limit fix as inviteUserAction,
    // applied to the other plan limit that was configurable but never
    // enforced: a tenant's connector count.
    const { checkSeatLimit } = await import("./usage");
    const connectorSeatCheck = await checkSeatLimit(user.tenantId!, "connectors");
    if (!connectorSeatCheck.ok) return { error: `Your plan allows up to ${connectorSeatCheck.limit} connected system${connectorSeatCheck.limit === 1 ? "" : "s"} — you're already at that limit. Upgrade your plan to connect more.` };

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
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 6 (2026-08-20) — OpenAPI-driven connector
// drafting. Parsing (parseOpenApiSpec, src/lib/openapi-import.ts) happens
// client-side — it's a pure function with no DB access or side effects, so
// there's nothing to gate server-side and no need for a round-trip just to
// preview a draft. The action below is the one real write: creates the
// Connector + ConnectorAction rows, but ONLY from whatever the human kept/
// edited in the review step (never rows nobody looked at). Reuses the exact
// same auth-config/encryptJSON path as createConnectorAction above — there
// is no separate "imported connector" code path at runtime.
// ─────────────────────────────────────────────────────────────────────────────

const draftParamSpecSchema = z.object({
  name: z.string(),
  in: z.enum(["path", "query", "body"]),
  required: z.boolean().optional(),
  from: z.enum(["entity", "grant", "const"]).optional(),
  entity: z.string().optional(),
});

const draftActionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1),
  paramSchema: z.array(draftParamSpecSchema),
  requiredPermission: z.string().optional(),
  requiresConfirm: z.boolean(),
  requiresStepUp: z.boolean(),
  riskLevel: z.enum(["low", "medium", "high"]),
});

const createFromDraftSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  baseUrl: z.string().url(),
  authType: z.enum(["none", "api_key", "bearer", "basic"]),
  apiKeyHeader: z.string().optional(),
  apiKeyValue: z.string().optional(),
  bearerToken: z.string().optional(),
  basicUser: z.string().optional(),
  basicPass: z.string().optional(),
  actionsJson: z.string().min(1),
});

/** Creates one Connector + N ConnectorActions from the reviewed/edited draft
 *  — only actions the human kept checked in the review step ever reach this
 *  (filtered client-side before the request), so an import can never
 *  silently activate a capability nobody looked at. */
export async function createConnectorFromDraftAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.CONNECTORS_MANAGE)) {
      return { error: "You don't have permission to manage connectors." };
    }
    const raw = Object.fromEntries(formData.entries());
    const parsed = createFromDraftSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
    const d = parsed.data;

    let draftActions: unknown;
    try {
      draftActions = JSON.parse(d.actionsJson);
    } catch {
      return { error: "Invalid capability data." };
    }
    const actionsParsed = z.array(draftActionSchema).min(1, "Select at least one capability.").safeParse(draftActions);
    if (!actionsParsed.success) return { error: actionsParsed.error.issues[0]?.message ?? "Invalid capability data." };

    // SSRF guard (2026-08-23 stress-test review, #31) — same check as
    // createConnectorAction; this path creates a Connector too and must not
    // bypass it.
    const { assertSafeUrl, UnsafeUrlError } = await import("./ssrf-guard");
    try {
      await assertSafeUrl(d.baseUrl);
    } catch (e) {
      if (e instanceof UnsafeUrlError) return { error: e.message };
      throw e;
    }

    // Gap-002 — same connector seat-limit check as createConnectorAction;
    // this path (OpenAPI import + marketplace install) creates a Connector
    // too and must not bypass the limit the manual form now enforces.
    const { checkSeatLimit } = await import("./usage");
    const connectorSeatCheck = await checkSeatLimit(user.tenantId!, "connectors");
    if (!connectorSeatCheck.ok) return { error: `Your plan allows up to ${connectorSeatCheck.limit} connected system${connectorSeatCheck.limit === 1 ? "" : "s"} — you're already at that limit. Upgrade your plan to connect more.` };

    let authConfig: unknown = { type: "none" };
    if (d.authType === "api_key") authConfig = { type: "api_key", header: d.apiKeyHeader || "x-api-key", value: d.apiKeyValue || "" };
    else if (d.authType === "bearer") authConfig = { type: "bearer", token: d.bearerToken || "" };
    else if (d.authType === "basic") authConfig = { type: "basic", username: d.basicUser || "", password: d.basicPass || "" };

    await db.connector.create({
      data: {
        tenantId: user.tenantId!,
        name: d.name,
        description: d.description,
        baseUrl: d.baseUrl,
        authType: d.authType,
        authConfigEnc: encryptJSON(authConfig),
        actions: {
          create: actionsParsed.data.map((a) => ({
            key: a.key.toUpperCase().replace(/\s+/g, "_"),
            name: a.name,
            method: a.method,
            path: a.path,
            paramSchema: a.paramSchema as unknown as object,
            requiredPermission: a.requiredPermission || null,
            requiresConfirm: a.requiresConfirm,
            requiresStepUp: a.requiresStepUp,
            riskLevel: a.riskLevel,
          })),
        },
      },
    });
    revalidatePath("/dashboard/connectors");
    redirect("/dashboard/connectors");
  });
}

// ── WhatsApp Embedded Signup (Phase 9) ────────────────────────────────────────
// Owner-only: connecting the org's real WhatsApp number via Meta's Meta-hosted
// Embedded Signup. `state` carries the tenant id through Meta's redirect so the
// callback route (src/app/api/whatsapp/embedded-signup/callback/route.ts) knows
// which tenant the returned authorization code belongs to.
export async function startWhatsAppEmbeddedSignupAction(_prev: unknown, _formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE)) {
      return { error: "Only an organization owner can connect a WhatsApp number." };
    }
    const link = buildEmbeddedSignupLink(user.tenantId!);
    if (!link.ok) return { error: link.error };
    redirect(link.url);
  });
}

// ── Facebook Messenger connection (Phase 8a) ──────────────────────────────────
// Owner-only, same shape as the WhatsApp Embedded Signup action above —
// standard Facebook Login OAuth rather than Meta's Embedded Signup, since
// Messenger has no equivalent "hosted" onboarding product.
export async function startMessengerConnectAction(_prev: unknown, _formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE)) {
      return { error: "Only an organization owner can connect a Facebook Page." };
    }
    const link = buildMessengerConnectLink(user.tenantId!);
    if (!link.ok) return { error: link.error };
    redirect(link.url);
  });
}

// ── Telegram connection (Phase 8d) ────────────────────────────────────────────
// Owner-only, but a fundamentally simpler shape than WhatsApp/Messenger above —
// no OAuth redirect, since there's no platform-wide Telegram app to authorize
// against. The tenant creates their own bot via @BotFather and pastes the
// token directly; connectTelegramBot() validates it and registers our webhook.
export async function connectTelegramBotAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE)) {
      return { error: "Only an organization owner can connect a Telegram bot." };
    }
    const botToken = String(formData.get("botToken") ?? "");
    const result = await connectTelegramBot(user.tenantId!, botToken);
    if (!result.ok) return { error: result.error };
    revalidatePath("/dashboard/channels");
    return { ok: true as const, username: result.username };
  });
}

// ── Email connection (Phase 8d) ───────────────────────────────────────────────
// Owner-only. Simpler even than Telegram — no credential to paste at all,
// since every tenant shares the platform's own Resend account; "connecting"
// just derives and activates this org's own address on it.
export async function activateEmailChannelAction(_prev: unknown, _formData: FormData) {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE)) {
      return { error: "Only an organization owner can activate the email channel." };
    }
    const result = await activateEmailChannel(user.tenantId!);
    if (!result.ok) return { error: result.error };
    revalidatePath("/dashboard/channels");
    return { ok: true as const, address: result.address };
  });
}

// ── Profile — self-service password change (real gap found 2026-08-23: the
// tenant dashboard had no profile page at all, unlike /admin/settings which
// already had this for platform admins) ────────────────────────────────────
const dashboardPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

export async function changePasswordAction(_prev: unknown, formData: FormData) {
  return withTenantUser(async (user) => {
    const parsed = dashboardPasswordSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
    const fullUser = await db.user.findUnique({ where: { id: user.id } });
    if (!fullUser || !(await verifyPassword(parsed.data.currentPassword, fullUser.passwordHash))) {
      return { error: "Current password is incorrect." };
    }
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword), passwordChangedAt: new Date() } });
    return { ok: true, message: "Password updated." };
  });
}

// ── Settings — real gap found 2026-08-23: Tenant.name/industry/branding are
// all live-consumed (conversation greetings, generated PDFs, the widget
// embed snippet) but were writable exactly once, at signup, with zero edit
// path anywhere afterward (confirmed: db.tenant.update across the whole
// codebase only ever touches faqs or status, never these fields). ─────────
type TenantSettingsInput = {
  name: string; industry: string;
  assistantName?: string; logoText?: string; primaryColor?: string; welcome?: string; poweredBy?: string; pdfFooter?: string;
};

export type InviteUserResult = { ok: true; email: string; password: string; emailSent: boolean } | { error: string };

// Real gap found 2026-08-23: /dashboard/users was read-only — the schema
// (User.emailCanonical's own comment) already anticipated "invited staff"
// as a user-creation path, but nothing ever implemented it. Only the one
// account created at /onboard could ever use the dashboard. Mirrors
// finalizeOnboarding's own owner-account pattern exactly (randomToken(6)
// password, shown once) rather than inventing a new credential scheme.
export async function inviteUserAction(_prev: unknown, formData: FormData): Promise<InviteUserResult> {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.USERS_MANAGE)) return { error: "You don't have permission to invite teammates." };

    const { rateLimit } = await import("./rate-limit");
    const invRate = rateLimit(`invite:user:${user.id}`, { max: 5, windowMs: 10 * 60 * 1000 });
    if (!invRate.ok) return { error: "Too many invites sent in a short time. Please wait a few minutes and try again." };

    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const roleId = String(formData.get("roleId") ?? "").trim();
    if (!name) return { error: "Name is required." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
    if (!roleId) return { error: "Pick a role." };

    const role = await db.role.findUnique({ where: { id: roleId } });
    if (!role || role.tenantId !== user.tenantId) return { error: "That role doesn't belong to your organization." };

    // User.email is globally unique across the whole platform (not per-tenant
    // — see the schema), so this really can collide with someone else's
    // account, not just a duplicate invite. Caught here with a clear message
    // rather than surfacing a raw P2002.
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return { error: `Someone already has an account with ${email}.` };

    // Gap-002, fixed 2026-08-23: the plan editor lets an admin configure a
    // "users" seat limit, but nothing enforced it — a Free-tier tenant could
    // invite unlimited staff. checkSeatLimit is a real live count (how many
    // Users this tenant has right now), not a monthly UsageEvent flow like
    // checkLimit() — a seat is a standing fact, not something that resets.
    const { checkSeatLimit } = await import("./usage");
    const seatCheck = await checkSeatLimit(user.tenantId!, "users");
    if (!seatCheck.ok) return { error: `Your plan allows up to ${seatCheck.limit} staff account${seatCheck.limit === 1 ? "" : "s"} — you're already at that limit. Upgrade your plan to add more.` };

    const password = randomToken(6);
    const tenant = await db.tenant.findUnique({ where: { id: user.tenantId! }, select: { name: true } });
    const created = await db.$transaction(async (tx) => {
      const newUser = await tx.user.create({ data: { tenantId: user.tenantId!, name, email, passwordHash: await hashPassword(password) } });
      await tx.userRole.create({ data: { userId: newUser.id, roleId } });
      return newUser;
    });

    const { audit } = await import("./audit");
    const { requestId: newRequestId } = await import("./crypto");
    await audit({ tenantId: user.tenantId!, requestId: newRequestId(), actorType: "user", actorId: user.id, action: "user.invited", target: created.id, success: true, detail: { invitedEmail: email, roleId, roleName: role.name } });

    // Never fake a send — same "no_provider_configured stays honest" rule as
    // every other outbound channel here (notification-channels.ts). If email
    // isn't configured, the inviting admin relays the credentials themselves,
    // same as the demo-code fallback used everywhere SMS isn't configured.
    const { isEmailConfigured, sendEmail } = await import("./notification-channels");
    let emailSent = false;
    if (isEmailConfigured()) {
      const res = await sendEmail({
        to: email,
        subject: `You've been added to ${tenant?.name ?? "your team"} on P2Less`,
        text: `Hi ${name},\n\n${user.name} added you to ${tenant?.name ?? "their P2Less workspace"} as ${role.name}.\n\nSign in at ${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/login with:\nEmail: ${email}\nPassword: ${password}\n\nYou can change your password after signing in.`,
      });
      emailSent = res.ok;
    }

    revalidatePath("/dashboard/users");
    return { ok: true, email, password, emailSent };
  });
}

// Offboarding — no path existed to revoke a departed staff member's dashboard
// access (2026-08-23 security review). Deactivation is checked in
// getCurrentUser(), so it takes effect on their very next request; reversible
// (reactivateUserAction), unlike a delete, since audit history references
// User.id and shouldn't be orphaned by an offboarding action.
export async function deactivateUserAction(_prev: unknown, formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.USERS_MANAGE)) return { error: "You don't have permission to manage teammates." };

    const targetId = String(formData.get("userId") ?? "").trim();
    if (!targetId) return { error: "Missing user." };
    if (targetId === user.id) return { error: "You can't deactivate your own account." };

    const target = await db.user.findUnique({ where: { id: targetId }, include: { userRoles: { include: { role: true } } } });
    if (!target || target.tenantId !== user.tenantId) return { error: "That teammate doesn't belong to your organization." };
    if (target.deactivatedAt) return { ok: true }; // already inactive — idempotent

    const isOwner = target.userRoles.some((ur) => ur.role.key === "owner");
    if (isOwner) {
      const otherActiveOwners = await db.user.count({
        where: { tenantId: user.tenantId!, id: { not: targetId }, deactivatedAt: null, userRoles: { some: { role: { key: "owner" } } } },
      });
      if (otherActiveOwners === 0) return { error: "Can't deactivate the only owner — assign another owner first." };
    }

    await db.user.update({ where: { id: targetId }, data: { deactivatedAt: new Date() } });

    const { audit } = await import("./audit");
    const { requestId: newRequestId } = await import("./crypto");
    await audit({ tenantId: user.tenantId!, requestId: newRequestId(), actorType: "user", actorId: user.id, action: "user.deactivated", target: targetId, success: true, detail: { targetEmail: target.email } });

    revalidatePath("/dashboard/users");
    return { ok: true };
  });
}

export async function reactivateUserAction(_prev: unknown, formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.USERS_MANAGE)) return { error: "You don't have permission to manage teammates." };

    const targetId = String(formData.get("userId") ?? "").trim();
    const target = await db.user.findUnique({ where: { id: targetId } });
    if (!target || target.tenantId !== user.tenantId) return { error: "That teammate doesn't belong to your organization." };

    const { checkSeatLimit } = await import("./usage");
    const seatCheck = await checkSeatLimit(user.tenantId!, "users");
    if (!seatCheck.ok) return { error: `Your plan allows up to ${seatCheck.limit} staff account${seatCheck.limit === 1 ? "" : "s"} — you're already at that limit. Upgrade your plan or deactivate someone else first.` };

    await db.user.update({ where: { id: targetId }, data: { deactivatedAt: null } });

    const { audit } = await import("./audit");
    const { requestId: newRequestId } = await import("./crypto");
    await audit({ tenantId: user.tenantId!, requestId: newRequestId(), actorType: "user", actorId: user.id, action: "user.reactivated", target: targetId, success: true, detail: { targetEmail: target.email } });

    revalidatePath("/dashboard/users");
    return { ok: true };
  });
}

export async function updateTenantSettingsAction(_prev: unknown, formData: FormData): Promise<{ ok?: boolean; unchanged?: boolean; error?: string }> {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE)) return { error: "You don't have permission to edit organization settings." };

    const name = String(formData.get("name") ?? "").trim();
    const industry = String(formData.get("industry") ?? "").trim();
    if (!name) return { error: "Organization name is required." };
    if (!industry) return { error: "Industry is required." };

    const branding: TenantSettingsInput = { name, industry };
    for (const key of ["assistantName", "logoText", "primaryColor", "welcome", "poweredBy", "pdfFooter"] as const) {
      const v = String(formData.get(key) ?? "").trim();
      if (v) branding[key] = v;
    }
    const newBranding = { assistantName: branding.assistantName, logoText: branding.logoText, primaryColor: branding.primaryColor, welcome: branding.welcome, poweredBy: branding.poweredBy, pdfFooter: branding.pdfFooter };

    // Real gap found 2026-08-23 (nav.ts gates Commerce/Integrations/Developer/
    // Widget nav groups on these, and a tenant that under-selected — or, like
    // every pre-existing tenant, signed up before this question existed —
    // had no edit path at all). Sorted before comparing so a re-save of the
    // exact same set in a different DOM order never reads as "changed".
    const useCases = formData.getAll("useCases").map(String);
    const channelsNeeded = formData.getAll("channelsNeeded").map(String);

    const current = await db.tenant.findUnique({ where: { id: user.tenantId! }, select: { name: true, industry: true, branding: true, useCases: true, channelsNeeded: true } });
    const currentBranding = (current?.branding as Record<string, string | undefined> | null) ?? {};
    const currentUseCases = ((current?.useCases as string[] | null) ?? []).slice().sort();
    const currentChannels = ((current?.channelsNeeded as string[] | null) ?? []).slice().sort();
    const unchanged = current?.name === name && current?.industry === industry
      && JSON.stringify(currentBranding) === JSON.stringify(newBranding)
      && JSON.stringify(currentUseCases) === JSON.stringify(useCases.slice().sort())
      && JSON.stringify(currentChannels) === JSON.stringify(channelsNeeded.slice().sort());
    if (unchanged) return { ok: true, unchanged: true };

    await db.tenant.update({ where: { id: user.tenantId! }, data: { name, industry, branding: newBranding, useCases, channelsNeeded } });
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/widget");
    return { ok: true };
  });
}
