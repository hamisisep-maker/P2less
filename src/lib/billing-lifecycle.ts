import "server-only";
import { db } from "./db";
import { audit } from "./audit";
import { requestId as newRequestId, randomToken } from "./crypto";
import { computeBill } from "./billing";
import { getSettingNumber } from "./platform-settings";
import { stkPush, isConfigured as mpesaConfigured, classifyMpesaFailure } from "./mpesa";
import { generateReceiptPdf } from "./documents";
import { registerJob, startJobPoller } from "./job-runner";
import { assertChannelEnabled, syncReconciliationFlag } from "./payment-channels";
import { classifyOutcome } from "./classify-outcome";
import { queueNotification } from "./notifications";

// ─────────────────────────────────────────────────────────────────────────────
// The subscription billing lifecycle — a real state machine, not scattered
// `if (renewsAt < now)` checks. Every transition below is the ONE place that
// changes Subscription.status / Tenant.status for billing reasons, and every
// transition writes a real AuditLog entry, so "who/what suspended this tenant
// and why" always has a real answer.
//
//   trial → active → renewal_due → payment_pending → grace_period → suspended
//                        ↑                 |                            |
//                        └── reactivated ──┴────────────────────────────┘
//                            (any real successful payment moves straight
//                             back to "active" from wherever it was)
//
// Payments drive this, not time alone: entering grace_period/suspended only
// ever happens after a REAL failed payment or a REAL absence of one past the
// grace deadline — never assumed. See reconciliationNeeded below for the
// "we don't actually know" case, which deliberately does NOT auto-suspend.
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: reminder TIMING itself is no longer read from a PlatformSetting —
// each NotificationRule carries its own timingDays (e.g. email at 7 days,
// WhatsApp at 3 days), which is the actual per-channel schedule the admin
// configures at /admin/billing/automation. billing_reminder_days stays as a
// convenience default used only when seeding a tenant's first rules.
async function billingSettings() {
  const [graceDays, maxRetries, retryHours, autoSuspend, autoCharge, reconcileHours] = await Promise.all([
    getSettingNumber("billing_grace_period_days"),
    getSettingNumber("billing_max_retries"),
    getSettingNumber("billing_retry_interval_hours"),
    getSettingNumber("billing_auto_suspend_enabled"),
    getSettingNumber("billing_auto_renew_charge_enabled"),
    getSettingNumber("billing_reconciliation_window_hours"),
  ]);
  return { graceDays, maxRetries, retryHours, autoSuspendEnabled: !!autoSuspend, autoChargeEnabled: !!autoCharge, reconcileHours };
}

/** Every automated transition goes through here — actorType "system" so it's
 *  visually distinct in the audit trail from a super admin's manual click,
 *  while landing in the exact same AuditLog a tenant dispute would be
 *  investigated from. */
async function billingAudit(tenantId: string, action: string, detail?: Record<string, unknown>, success = true) {
  await audit({ tenantId, requestId: newRequestId(), actorType: "system", action: `billing.${action}`, success, detail }).catch(() => {});
}

/** Real evidence a payment failed OR the grace deadline passed with none —
 *  never the mere passage of time alone. Moves toward suspension one step at
 *  a time (payment_pending → grace_period → suspended), each step logged. */
export async function recordFailedPayment(tenantId: string, reason: string) {
  const settings = await billingSettings();
  const sub = await db.subscription.findUnique({ where: { tenantId } });
  if (!sub) return;
  // A renewal charge that was already in flight (payment_pending) at the
  // moment the tenant self-service-cancelled can still resolve after
  // cancellation completes — Safaricom's callback doesn't know the
  // subscription moved on underneath it. A cancelled subscription must never
  // enter a retry schedule or grace period; there's nothing left to retry
  // toward. See cancelSubscriptionAction's own comment for the mirror case
  // on the success side (handleSubscriptionPaymentConfirmed below).
  if (sub.status === "cancelled") {
    await billingAudit(tenantId, "stray_payment_failure_on_cancelled_subscription", { reason }, false);
    return;
  }
  const attempts = sub.paymentAttemptCount + 1;

  if (attempts < settings.maxRetries) {
    const nextAttempt = new Date(Date.now() + settings.retryHours * 60 * 60 * 1000);
    await db.subscription.update({
      where: { tenantId },
      data: { paymentAttemptCount: attempts, paymentFailureReason: reason, nextPaymentAttemptAt: nextAttempt, reconciliationNeeded: false },
    });
    await billingAudit(tenantId, "payment_retry_scheduled", { attempt: attempts, maxRetries: settings.maxRetries, reason, nextAttempt: nextAttempt.toISOString() }, false);
    return;
  }

  // Retries exhausted — enter grace period rather than suspending immediately,
  // so a tenant who's traveling or whose bank declined once still gets days
  // to sort it out before their assistant actually stops responding.
  const graceEndsAt = new Date(Date.now() + settings.graceDays * 24 * 60 * 60 * 1000);
  await db.subscription.update({
    where: { tenantId },
    data: { status: "grace_period", paymentAttemptCount: attempts, paymentFailureReason: reason, graceEndsAt, reconciliationNeeded: false },
  });
  await billingAudit(tenantId, "grace_period_started", { attempts, reason, graceEndsAt: graceEndsAt.toISOString() }, false);
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  await queueNotification("payment_failed", `${tenant?.name}: renewal payment failed after ${attempts} attempts (${reason}). Service continues for ${settings.graceDays} more day(s), then pauses automatically.`, { tenantId });
}

/** The ONLY place Tenant.status flips to "suspended" for a billing reason —
 *  reuses the exact mechanism already proven (see admin-actions.ts
 *  suspendTenantAction) to actually stop the WhatsApp number from
 *  responding, just tagged as an automated action in the audit trail. */
export async function suspendForNonPayment(tenantId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status === "suspended") return; // idempotent — already suspended, nothing to do
  await db.tenant.update({ where: { id: tenantId }, data: { status: "suspended" } });
  await db.subscription.update({ where: { tenantId }, data: { status: "suspended" } }).catch(() => {});
  await billingAudit(tenantId, "auto_suspended", { reason: "grace period ended with no successful payment" });
  await queueNotification("account_suspended", `${tenant.name}'s P2Less assistant has been paused — grace period ended with no payment received. Reactivates automatically the moment payment is confirmed.`, { tenantId });
}

/** The ONLY place a billing-suspended tenant comes back — real payment
 *  confirmation is the sole trigger, never a timer or an admin's assumption. */
export async function reactivateAfterPayment(tenantId: string, plan: { interval: string }) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const wasSuspended = tenant?.status === "suspended";
  const renewsAt = nextRenewalDate(new Date(), plan.interval);
  await db.tenant.update({ where: { id: tenantId }, data: { status: "active" } }).catch(() => {});
  await db.subscription.update({
    where: { tenantId },
    data: {
      status: "active", renewsAt, lastPaymentAt: new Date(),
      paymentAttemptCount: 0, paymentFailureReason: null, nextPaymentAttemptAt: null, graceEndsAt: null, reconciliationNeeded: false,
    },
  });
  await billingAudit(tenantId, wasSuspended ? "reactivated" : "renewed", { renewsAt: renewsAt.toISOString() });
  if (wasSuspended) await queueNotification("account_reactivated", "Payment confirmed — your P2Less assistant is active again.", { tenantId });
}

function nextRenewalDate(from: Date, interval: string): Date {
  const d = new Date(from);
  if (interval === "yearly") d.setFullYear(d.getFullYear() + 1);
  else if (interval === "half_yearly") d.setMonth(d.getMonth() + 6);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** Called from the M-Pesa callback route when a purpose="subscription"
 *  payment is CONFIRMED paid by Safaricom — the real event that drives the
 *  whole lifecycle forward, never a button click alone. */
export async function handleSubscriptionPaymentConfirmed(payment: { id: string; tenantId: string; reference: string; amount: number; currency: string; method: string; periodLabel: string | null }) {
  const sub = await db.subscription.findUnique({ where: { tenantId: payment.tenantId }, include: { plan: true } });
  if (!sub) return;
  // Real race, found while designing self-service cancellation: a renewal
  // charge sent BEFORE the tenant cancelled can still get confirmed paid
  // AFTER cancellation already completed (Safaricom's callback is fully
  // async, independent of when the tenant clicked cancel). Blindly
  // reactivating here would silently undo a real cancellation the moment a
  // stray in-flight payment resolves. The money is still real and still
  // owed to nobody in particular now — recorded and audited, just not used
  // to bring a cancelled tenant back.
  if (sub.status === "cancelled") {
    await billingAudit(payment.tenantId, "stray_payment_confirmed_on_cancelled_subscription", { reference: payment.reference, amount: payment.amount });
    return;
  }
  await reactivateAfterPayment(payment.tenantId, sub.plan);
  const tenant = await db.tenant.findUnique({ where: { id: payment.tenantId } });
  if (tenant) {
    const receipt = await generateReceiptPdf({
      tenantId: payment.tenantId, org: tenant.name,
      reference: payment.reference, amount: payment.amount, currency: payment.currency, method: payment.method,
      paidAt: new Date(), periodLabel: payment.periodLabel ?? undefined, planName: sub.plan.name,
    }).catch(() => null);
    await billingAudit(payment.tenantId, "payment_confirmed", { reference: payment.reference, amount: payment.amount, receiptUrl: receipt?.url });
    await queueNotification("payment_received", `Payment of ${payment.currency} ${payment.amount.toLocaleString("en-US")} confirmed for ${tenant.name}. Receipt: ${receipt?.url ?? "(generation failed)"}`, { tenantId: payment.tenantId });
  }
}

/** Subscription cancellation, 2026-08-24 (Gap Register item 3) — the actual
 *  cutoff. Admin-only by explicit direction (a self-service version was
 *  built first, then deliberately rejected — see admin-actions.ts's
 *  cancelTenantSubscriptionAction, the only real caller). Called
 *  SYNCHRONOUSLY, before anything about the outstanding balance is touched:
 *  an earlier version of this waited for a payment to be confirmed before
 *  cutting off access, which meant a tenant who never completed payment
 *  stayed fully active — and kept costing Hamzone real Meta/AI money —
 *  indefinitely, since the subscription would still read "active" to
 *  runBillingCycle() and wouldn't hit the non-payment grace-period
 *  machinery until its next natural renewal date, potentially weeks away.
 *  Cutoff is unconditional and immediate; collecting what's owed for the
 *  final cycle is a fully separate step (billed + emailed, not an
 *  automated payment prompt — see cancelTenantSubscriptionAction) that
 *  never gates this. Reuses Tenant.status="suspended"'s proven access-gate
 *  in conversation.ts (now also recognizing "cancelled" — see there) and
 *  sets Subscription.status="cancelled", the value that already existed in
 *  the schema but nothing ever set. runBillingCycle()'s own query only
 *  selects active/renewal_due/payment_pending/grace_period subscriptions,
 *  so a cancelled one is never billed, reminded, or auto-suspended again. */
export async function finalizeCancellation(tenantId: string) {
  await db.tenant.update({ where: { id: tenantId }, data: { status: "cancelled" } });
  await db.subscription.update({ where: { tenantId }, data: { status: "cancelled" } }).catch(() => {});
  await billingAudit(tenantId, "cancelled", {});
}

/** Called from the M-Pesa callback route when a subscription payment
 *  DEFINITIVELY failed (Safaricom returned a real failure result, not just
 *  "no callback yet"). */
export async function handleSubscriptionPaymentFailed(payment: { tenantId: string; reference: string }, reason: string) {
  await recordFailedPayment(payment.tenantId, reason);
}

/** Fires a REAL STK push to the subscription's on-file billing phone — never
 *  invents a number. Used both by the poller's automated retries and can be
 *  called directly for the very first renewal attempt. */
/** confirmed=true means the payment is ALREADY fully resolved (mock mode has
 *  no callback to wait for, so it's confirmed synchronously here — same
 *  as startPaymentAction's manual mock path); confirmed=false means a real
 *  STK push is in flight and the caller should move to payment_pending and
 *  wait for the Daraja callback route to resolve it. */
async function attemptAutomatedCharge(sub: { tenantId: string; billingPhone: string | null }, amount: number, reference: string): Promise<{ ok: boolean; skipped?: string; confirmed?: boolean }> {
  if (!sub.billingPhone) return { ok: false, skipped: "no billing phone on file" };
  const channelCheck = await assertChannelEnabled("mpesa_stk");
  if (!channelCheck.ok) return { ok: false, skipped: channelCheck.error };
  const periodLabel = new Date().toISOString().slice(0, 7);
  if (!mpesaConfigured()) {
    // Demo/no-keys mode — record it as an instant mock success and drive it
    // through the SAME confirmation handler a real webhook would use, so the
    // lifecycle is genuinely exercisable end to end without real Daraja
    // creds — never a shortcut that skips reactivation/receipt/notification.
    const payment = await db.payment.create({ data: { tenantId: sub.tenantId, reference, amount, currency: "KES", purpose: "subscription", method: "mpesa", channelKey: "mpesa_stk", status: "paid", provider: "mock", periodLabel, paidAt: new Date() } });
    await handleSubscriptionPaymentConfirmed({ id: payment.id, tenantId: sub.tenantId, reference, amount, currency: "KES", method: "mpesa", periodLabel });
    return { ok: true, confirmed: true };
  }
  await db.payment.create({ data: { tenantId: sub.tenantId, reference, amount, currency: "KES", purpose: "subscription", method: "mpesa", channelKey: "mpesa_stk", status: "pending", provider: "daraja", periodLabel } });
  const res = await stkPush({ phone: sub.billingPhone, amount, accountRef: reference, description: "P2Less renewal" });
  if (!res.ok) {
    await db.payment.updateMany({ where: { reference }, data: { status: "failed", failureCategory: classifyMpesaFailure(res.error), failureReason: res.error.slice(0, 300) } });
    return { ok: false, skipped: res.error };
  }
  await db.payment.updateMany({ where: { reference }, data: { providerRef: res.checkoutId } });
  return { ok: true, confirmed: false };
}

/** The billing engine's single entry point — call periodically (see
 *  startBillingPoller below). Every tenant is evaluated independently and
 *  idempotently; running this twice in a row never double-charges or
 *  double-suspends anyone. */
export async function runBillingCycle(): Promise<{ reminders: number; renewalsAttempted: number; suspended: number; reactivatedFromReconciliation: number }> {
  const settings = await billingSettings();
  const now = new Date();
  let reminders = 0, renewalsAttempted = 0, suspended = 0, reactivatedFromReconciliation = 0;

  const subs = await db.subscription.findMany({ where: { status: { in: ["active", "renewal_due", "payment_pending", "grace_period"] } }, include: { plan: true, tenant: true } });

  for (const sub of subs) {
    if (sub.tenant.status === "suspended" && sub.status !== "suspended") {
      // Tenant was suspended some OTHER way (e.g. a super admin manually) —
      // don't let the billing engine fight that; leave it alone.
      continue;
    }

    // Reconciliation safety: an STK push was sent (payment_pending) long
    // enough ago that we should have heard back by now, but didn't. This is
    // "we don't know", not "it failed" — flag it and stop treating it as a
    // normal pending payment; a real admin needs to look, not the poller.
    // Payment.status becomes the real source of truth ("unknown"); Subscription
    // .reconciliationNeeded is kept in sync as a derived read-cache (see
    // payment-channels.ts's syncReconciliationFlag) for existing read sites.
    if (sub.status === "payment_pending" && !sub.reconciliationNeeded) {
      const pendingPayment = await db.payment.findFirst({ where: { tenantId: sub.tenantId, purpose: "subscription", status: "pending" }, orderBy: { createdAt: "desc" } });
      if (pendingPayment) {
        const ageMs = now.getTime() - pendingPayment.createdAt.getTime();
        const outcome = classifyOutcome({ definitiveResponseReceived: false, ageMs, reconciliationWindowMs: settings.reconcileHours * 3_600_000 });
        if (outcome.kind === "unknown" && ageMs > settings.reconcileHours * 3_600_000) {
          await db.payment.update({ where: { id: pendingPayment.id }, data: { status: "unknown" } });
          await syncReconciliationFlag(sub.tenantId);
          await billingAudit(sub.tenantId, "reconciliation_needed", { paymentReference: pendingPayment.reference, ageHours: Math.round(ageMs / 3_600_000) }, false);
        }
      }
    }
    if (sub.reconciliationNeeded) continue; // never auto-progress an ambiguous case

    // Reminders — each NotificationRule's OWN timingDays is the schedule (an
    // admin can genuinely set email at 7 days and WhatsApp at 3 days for the
    // same event); queueNotification only fires rules matching TODAY's exact
    // daysToRenewal, and is idempotent per (tenant, event, channel, day).
    if (["active", "renewal_due"].includes(sub.status)) {
      const daysToRenewal = Math.ceil((sub.renewsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysToRenewal >= 0) {
        reminders += await queueNotification("renewal_reminder", `${sub.tenant.name}'s P2Less plan (${sub.plan.name}) renews in ${daysToRenewal} day(s).`, { tenantId: sub.tenantId, timingDays: daysToRenewal });
      }
    }

    // Renewal due → attempt the automated charge (or just mark due if
    // auto-renew is off / no billing phone on file — manual "Pay Now" still
    // works either way, see /dashboard/billing).
    if (sub.status === "active" && sub.renewsAt <= now) {
      // A downgrade requested via changeTenantPlanAction (admin-actions.ts)
      // takes effect HERE — the old cycle has just ended, a fresh one is
      // about to start, so applying the new (lower) plan now means
      // computeBill() below will already read the correct rate for this
      // new cycle's usage, with nothing retroactively recomputed for usage
      // already incurred under the old plan.
      const planUpdate: { status: string; planId?: string; pendingPlanId?: null } = { status: "renewal_due" };
      if (sub.pendingPlanId) {
        planUpdate.planId = sub.pendingPlanId;
        planUpdate.pendingPlanId = null;
        await billingAudit(sub.tenantId, "plan_downgrade_applied", { newPlanId: sub.pendingPlanId });
      }
      await db.subscription.update({ where: { tenantId: sub.tenantId }, data: planUpdate });
      await billingAudit(sub.tenantId, "renewal_due");
      sub.status = "renewal_due";
    }
    if (sub.status === "renewal_due" && sub.autoRenew && settings.autoChargeEnabled && sub.billingPhone) {
      const bill = await computeBill(sub.tenantId);
      const reference = "PAY-" + randomToken(4).toUpperCase();
      const result = await attemptAutomatedCharge(sub, bill.total, reference);
      renewalsAttempted++;
      if (result.ok && !result.confirmed) {
        // Real STK push in flight — wait for the Daraja callback route.
        await db.subscription.update({ where: { tenantId: sub.tenantId }, data: { status: "payment_pending" } });
        await billingAudit(sub.tenantId, "renewal_charge_sent", { reference, amount: bill.total });
      } else if (result.ok && result.confirmed) {
        // Mock mode already resolved it (handleSubscriptionPaymentConfirmed
        // ran inside attemptAutomatedCharge) — subscription is "active" now,
        // nothing more to do here.
        await billingAudit(sub.tenantId, "renewal_charge_confirmed", { reference, amount: bill.total });
      } else {
        await billingAudit(sub.tenantId, "renewal_charge_skipped", { reason: result.skipped }, false);
      }
    }

    // A scheduled retry has come due.
    if (sub.status === "payment_pending" && sub.nextPaymentAttemptAt && sub.nextPaymentAttemptAt <= now && !sub.reconciliationNeeded) {
      const bill = await computeBill(sub.tenantId);
      const reference = "PAY-" + randomToken(4).toUpperCase();
      const result = await attemptAutomatedCharge(sub, bill.total, reference);
      renewalsAttempted++;
      const label = !result.ok ? "retry_charge_skipped" : result.confirmed ? "retry_charge_confirmed" : "retry_charge_sent";
      await billingAudit(sub.tenantId, label, { reference, amount: bill.total, reason: result.skipped }, result.ok);
    }

    // Grace period elapsed with still no successful payment → suspend, for real.
    if (sub.status === "grace_period" && sub.graceEndsAt && sub.graceEndsAt <= now) {
      if (settings.autoSuspendEnabled) {
        await suspendForNonPayment(sub.tenantId);
        suspended++;
      } else {
        await billingAudit(sub.tenantId, "auto_suspend_skipped", { reason: "billing_auto_suspend_enabled is off" }, false);
      }
    }
  }

  return { reminders, renewalsAttempted, suspended, reactivatedFromReconciliation };
}

/** Starts the periodic billing cycle. Every execution — success or failure,
 *  scheduled or manually triggered from /admin/system-health — now goes
 *  through job-runner.ts's runJobNow(), which records a real JobRun row
 *  (duration, result, error) instead of a fire-and-forget setInterval
 *  callback. This is what lets an incident review answer "why wasn't this
 *  tenant suspended?" with a real timestamped answer. */
export function startBillingPoller(intervalMs = 15 * 60 * 1000) {
  registerJob({ key: "billing_poller", name: "Billing lifecycle cycle", category: "billing", intervalMs, run: runBillingCycle });
  startJobPoller("billing_poller");
}
