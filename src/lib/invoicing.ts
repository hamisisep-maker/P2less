"use server";
import { db } from "./db";
import { audit } from "./audit";
import { requestId as newRequestId } from "./crypto";
import { getSettingNumber } from "./platform-settings";
import { withTenantUser, userPermissions } from "./auth";
import { PERMISSIONS } from "./permissions";
import { stkPush, isConfigured, classifyMpesaFailure } from "./mpesa";
import { assertChannelEnabled } from "./payment-channels";
import { randomToken } from "./crypto";
import { computeProration } from "./proration";
import { settleInvoice, nextInvoiceNumber, normalizeInvoiceRef, loadFreshInvoiceForAction } from "./invoice-settlement";

// ─────────────────────────────────────────────────────────────────────────────
// Invoice-centric paid-upgrade flow, 2026-08-25 — the Invoice IS the primary
// billing reference (never a phone number, never an account id). Every
// payment method converges on settleInvoice() (invoice-settlement.ts), the
// ONE function that ever moves an invoice "awaiting_payment" -> "paid" and
// applies the plan change. See docs/GAP-REGISTER item 6 for the bug this
// replaces: self-service upgrade previously applied planId with ZERO
// payment step of any kind.
//
// "use server" — the two functions below are called directly from a client
// component (dashboard/billing/upgrade-modal.tsx) as real Server Actions.
// Deliberately thin: proration math (proration.ts) and the actual
// settlement/numbering logic (invoice-settlement.ts) both live in plain
// "server-only" modules instead, so the only things a client can ever
// reach here are these two request-scoped, permission-checked actions —
// never the lower-level settlement primitive directly.
// ─────────────────────────────────────────────────────────────────────────────

type CreateInvoiceResult = { ok: true; invoice: NonNullable<Awaited<ReturnType<typeof loadFreshInvoiceForAction>>> } | { error: string };

/** Tenant self-service — server-side computed and re-verified at every
 *  step, the client never submits an amount. Reuses upgradeSubscriptionPlanAction's
 *  exact direction check (Plan.sort, not priceMonthly — Enterprise prices at
 *  0, same as the internal trial plan, but is the top tier). Reuses an
 *  existing non-expired invoice for the SAME target plan (handles repeated
 *  clicks/navigation without spamming invoices); a DIFFERENT target plan
 *  supersedes (cancels) the stale one rather than trapping the tenant into
 *  paying for a plan they no longer want. */
export async function createUpgradeInvoiceAction(newPlanId: string): Promise<CreateInvoiceResult> {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.BILLING_MANAGE)) return { error: "You don't have billing permission." };
    const tenantId = user.tenantId!;
    const [sub, newPlan] = await Promise.all([
      db.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      db.plan.findUnique({ where: { id: newPlanId } }),
    ]);
    if (!sub) return { error: "No subscription found." };
    if (!newPlan || !newPlan.active) return { error: "That plan isn't available." };
    if (newPlan.sort <= sub.plan.sort) return { error: "Downgrading isn't self-service — contact us and we'll take care of it." };
    // Real gap caught in testing, 2026-08-25 — Enterprise prices at 0
    // (negotiated contract, billed post-paid outside this flow entirely).
    // Without this guard, "upgrading" to it would compute payableKes = 0
    // for EVERY tenant (toPlanPriceKes 0 minus any non-negative credit is
    // always <= 0) and auto-settle for free through the same $0-invoice
    // path a legitimate full-credit upgrade uses — a real bypass, not a
    // bypass anyone intended. Enterprise is admin-only, always (see
    // changeTenantPlanAction, admin-actions.ts) — every comment on
    // Plan.postpaidUsage in this codebase already says so.
    if (newPlan.postpaidUsage) return { error: "That plan requires a negotiated contract — contact us to move to it." };

    const expiryHours = await getSettingNumber("invoice_expiry_hours");
    const expiryCutoff = new Date(Date.now() - expiryHours * 60 * 60 * 1000);
    const existing = await db.invoice.findFirst({
      where: { tenantId, status: "awaiting_payment", createdAt: { gte: expiryCutoff } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      if (existing.toPlanId === newPlan.id) {
        const fresh = await loadFreshInvoiceForAction(existing.id);
        if (fresh) return { ok: true, invoice: fresh };
      } else {
        // A different plan was chosen — the old invoice no longer reflects
        // what the tenant wants to pay for. Supersede it rather than
        // silently trapping them into an old, unrelated payment obligation.
        await db.invoice.update({ where: { id: existing.id }, data: { status: "cancelled" } });
        await audit({ tenantId, requestId: newRequestId(), actorType: "user", actorId: user.id, action: "invoice.superseded", target: existing.invoiceNumber, success: true, detail: { reason: "different plan selected" } });
      }
    }

    const now = new Date();
    const proration = computeProration(sub.plan.priceMonthly, sub.currentPeriodStartedAt, sub.renewsAt, now);
    const payableKes = Math.max(0, newPlan.priceMonthly - proration.remainingValueKes);
    const invoiceNumber = await nextInvoiceNumber();

    const invoice = await db.invoice.create({
      data: {
        invoiceNumber, normalizedInvoiceNumber: normalizeInvoiceRef(invoiceNumber), tenantId, kind: "plan_change",
        fromPlanId: sub.planId, toPlanId: newPlan.id,
        fromPlanValueKes: sub.plan.priceMonthly,
        usedDays: proration.usedDays, remainingDays: proration.remainingDays, daysInCycle: proration.daysInCycle,
        remainingValueKes: proration.remainingValueKes, toPlanPriceKes: newPlan.priceMonthly, payableKes,
        createdByUserId: user.id,
      },
      include: { toPlan: true, fromPlan: true, tenant: true },
    });
    await audit({
      tenantId, requestId: newRequestId(), actorType: "user", actorId: user.id, action: "invoice.created", target: invoiceNumber, success: true,
      detail: { fromPlan: sub.plan.name, toPlan: newPlan.name, remainingValueKes: proration.remainingValueKes, payableKes },
    });

    if (payableKes === 0) {
      // Real KES 0 invoice — goes through the EXACT SAME settlement path as
      // a paid one (settleInvoice), never a special-cased bypass. The
      // remaining plan credit fully covers the new plan's price; the excess
      // beyond that is forfeited (no persistent credit-balance concept —
      // consistent with how messageBalanceKes/aiBalanceKes already work:
      // spend or lose, never negative, never a new financial primitive
      // introduced for one edge case).
      await settleInvoice(invoice.id);
      const settled = await loadFreshInvoiceForAction(invoice.id);
      if (settled) return { ok: true, invoice: settled };
    }
    return { ok: true, invoice };
  });
}

/** Paybill, 2026-08-25 — real availability, not assumed. Checks both the
 *  existing channel gate (assertChannelEnabled, same one STK already uses)
 *  AND that a real business shortcode is actually configured — never shows
 *  Paybill as available with no real number to display. */
export async function getPaybillInfo(): Promise<{ available: boolean; shortcode?: string }> {
  const channelCheck = await assertChannelEnabled("mpesa_paybill");
  if (!channelCheck.ok) return { available: false };
  const channel = await db.paymentChannel.findUnique({ where: { key: "mpesa_paybill" } });
  const shortcode = (channel?.configJson as { shortcode?: string } | null)?.shortcode;
  if (!shortcode) return { available: false };
  return { available: true, shortcode };
}

type InitiatePaymentResult = { ok: true; ref?: string; checkoutId?: string; mock?: boolean; message: string } | { error: string };

/** Reloads the invoice fresh — never trusts a client-held amount. The
 *  invoicePendingKey unique constraint (Payment model) is a DB-enforced
 *  compare-and-swap: two simultaneous requests for the SAME invoice both
 *  attempt to create a Payment with invoicePendingKey = invoiceId, and only
 *  one can win — the loser hits a real P2002 violation, not an app-level
 *  race window between a SELECT and an INSERT. */
export async function initiateInvoiceStkPaymentAction(invoiceId: string, phone: string): Promise<InitiatePaymentResult> {
  return withTenantUser(async (user) => {
    if (!userPermissions(user).includes(PERMISSIONS.BILLING_MANAGE)) return { error: "You don't have billing permission." };
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.tenantId !== user.tenantId) return { error: "Invoice not found." };
    const expiryHours = await getSettingNumber("invoice_expiry_hours");
    if (invoice.createdAt.getTime() < Date.now() - expiryHours * 60 * 60 * 1000) return { error: "This invoice has expired — go back and start the upgrade again." };
    if (invoice.status === "paid") return { error: "This invoice is already paid." };
    if (invoice.status !== "awaiting_payment") return { error: "This invoice is no longer payable." };
    if (invoice.payableKes <= 0) return { error: "Nothing is payable on this invoice." };

    const channelCheck = await assertChannelEnabled("mpesa_stk");
    if (!channelCheck.ok) return { error: channelCheck.error };

    const reference = "INVPAY-" + randomToken(4).toUpperCase();
    let payment;
    try {
      payment = await db.payment.create({
        data: {
          tenantId: invoice.tenantId, invoiceId: invoice.id, invoicePendingKey: invoice.id,
          reference, amount: invoice.payableKes, currency: invoice.currency,
          purpose: "plan_change", method: "mpesa", channelKey: "mpesa_stk", status: "pending", provider: "daraja",
        },
      });
    } catch {
      // P2002 on invoicePendingKey — another request already has a pending
      // payment in flight for this exact invoice. Return that one instead
      // of firing a second stkPush() (the double-click/multi-tab guard).
      const inFlight = await db.payment.findFirst({ where: { invoiceId: invoice.id, status: "pending" }, orderBy: { createdAt: "desc" } });
      if (inFlight) return { ok: true, ref: inFlight.reference, message: "A payment for this invoice is already in progress — check your phone." };
      return { error: "Could not start payment — please try again." };
    }

    if (!isConfigured()) {
      await db.payment.update({ where: { id: payment.id }, data: { status: "paid", paidAt: new Date(), providerRef: "MOCK-" + randomToken(3).toUpperCase(), invoicePendingKey: null } });
      const settle = await settleInvoice(invoice.id);
      return { ok: true, mock: true, message: settle.settled ? "Recorded (demo mode — set M-Pesa keys in .env for a real STK push). Your upgrade is now active." : "Recorded (demo mode)." };
    }

    const res = await stkPush({ phone, amount: invoice.payableKes, accountRef: invoice.invoiceNumber, description: `P2Less upgrade ${invoice.invoiceNumber}` });
    if (!res.ok) {
      await db.payment.update({ where: { id: payment.id }, data: { status: "failed", invoicePendingKey: null, failureCategory: classifyMpesaFailure(res.error), failureReason: res.error.slice(0, 300) } });
      return { error: res.error };
    }
    await db.payment.update({ where: { id: payment.id }, data: { providerRef: res.checkoutId } });
    return { ok: true, ref: reference, checkoutId: res.checkoutId, message: res.customerMessage };
  });
}
