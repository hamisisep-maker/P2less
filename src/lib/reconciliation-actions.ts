"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { assertAdminPermission, logPrivilegedAction, ForbiddenError } from "./admin-authz";
import { randomToken } from "./crypto";
import { syncReconciliationFlag } from "./payment-channels";
import { handleSubscriptionPaymentConfirmed, recordFailedPayment } from "./billing-lifecycle";

function isForbidden(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

const createUnmatchedSchema = z.object({
  channelKey: z.enum(["bank_transfer", "mpesa_paybill", "mpesa_till"]),
  providerRef: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  occurredAt: z.string().min(1),
  senderName: z.string().optional(),
  senderMsisdn: z.string().optional(),
  reference: z.string().optional(),
});

/** Admin-entered evidence of a payment-provider transaction that never came
 *  through a webhook — the bank-statement-line workflow. Never a live feed;
 *  always what an admin actually saw and typed in. */
export async function createUnmatchedTransactionAction(_prev: unknown, formData: FormData) {
  let admin;
  try {
    admin = await assertAdminPermission("reconciliation.match");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const parsed = createUnmatchedSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const row = await db.unmatchedTransaction.create({
    data: {
      channelKey: d.channelKey, providerRef: d.providerRef, amount: d.amount, currency: "KES",
      occurredAt: new Date(d.occurredAt), senderName: d.senderName, senderMsisdn: d.senderMsisdn,
      reference: d.reference, rawPayload: { enteredManually: true, enteredBy: admin.email },
    },
  });
  await logPrivilegedAction({
    admin, permission: "reconciliation.match", action: "admin.unmatched_transaction_entered",
    target: row.providerRef, detail: { channelKey: d.channelKey, amount: d.amount },
  });
  revalidatePath("/admin/reconciliation");
  return { ok: true };
}

/** Matches an UnmatchedTransaction to a tenant — creates the real Payment,
 *  drives it through the SAME confirmation handler a webhook would use, and
 *  records exactly who matched it, why. Never a silent/automatic match. */
export async function matchUnmatchedTransactionAction(unmatchedTxId: string, tenantId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("reconciliation.match", { tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const tx = await db.unmatchedTransaction.findUnique({ where: { id: unmatchedTxId } });
  if (!tx) return { error: "Transaction not found." };
  if (tx.status !== "unmatched") return { error: `This transaction is already ${tx.status}.` };
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { error: "Tenant not found." };

  const reference = "MATCH-" + randomToken(4).toUpperCase();
  const payment = await db.payment.create({
    data: {
      tenantId, reference, amount: tx.amount, currency: tx.currency, purpose: "subscription",
      method: tx.channelKey.startsWith("mpesa") ? "mpesa" : "bank", channelKey: tx.channelKey,
      status: "paid", provider: "manual", providerRef: tx.providerRef, periodLabel: new Date().toISOString().slice(0, 7), paidAt: new Date(),
    },
  });
  await handleSubscriptionPaymentConfirmed({
    id: payment.id, tenantId, reference, amount: tx.amount, currency: tx.currency, method: payment.method, periodLabel: payment.periodLabel,
  }).catch((e) => console.error("[reconciliation] handleSubscriptionPaymentConfirmed failed:", e));

  await db.unmatchedTransaction.update({
    where: { id: unmatchedTxId },
    data: { status: "matched", matchedTenantId: tenantId, matchedPaymentId: payment.id, matchedById: admin.id, matchedAt: new Date(), matchReason: reason },
  });

  await logPrivilegedAction({
    admin, permission: "reconciliation.match", tenantId, action: "admin.transaction_matched",
    target: tx.providerRef, reason, newState: { tenantId, paymentId: payment.id, amount: tx.amount },
  });
  revalidatePath("/admin/reconciliation");
  revalidatePath("/admin/tenants");
  return { ok: true };
}

export async function ignoreUnmatchedTransactionAction(unmatchedTxId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  let admin;
  try {
    admin = await assertAdminPermission("reconciliation.match");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const tx = await db.unmatchedTransaction.findUnique({ where: { id: unmatchedTxId } });
  if (!tx) return { error: "Transaction not found." };
  if (tx.status !== "unmatched") return { error: `This transaction is already ${tx.status}.` };
  await db.unmatchedTransaction.update({ where: { id: unmatchedTxId }, data: { status: "ignored", matchedById: admin.id, matchedAt: new Date(), matchReason: reason } });
  await logPrivilegedAction({ admin, permission: "reconciliation.match", action: "admin.unmatched_transaction_ignored", target: tx.providerRef, reason });
  revalidatePath("/admin/reconciliation");
  return { ok: true };
}

/** Resolves a Payment stuck at status="unknown" — the generalized,
 *  channel-agnostic version of the older Subscription-only
 *  clearReconciliationAction (kept for backward compat in admin-actions.ts;
 *  Subscription.reconciliationNeeded is now derived FROM this via
 *  syncReconciliationFlag). "paid" drives the real confirmation handler;
 *  "failed" is a genuine, evidenced conclusion the admin is asserting — both
 *  require a reason and are audited. */
export async function resolvePaymentUnknownAction(paymentId: string, resolution: "paid" | "failed", reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return { error: "Payment not found." };
  let admin;
  try {
    admin = await assertAdminPermission("reconciliation.match", { tenantId: payment.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  if (payment.status !== "unknown") return { error: `This payment is not in an unknown state (currently "${payment.status}").` };

  if (resolution === "paid") {
    await db.payment.update({ where: { id: payment.id }, data: { status: "paid", paidAt: new Date() } });
    if (payment.purpose === "subscription") {
      await handleSubscriptionPaymentConfirmed({
        id: payment.id, tenantId: payment.tenantId, reference: payment.reference, amount: payment.amount,
        currency: payment.currency, method: payment.method, periodLabel: payment.periodLabel,
      }).catch((e) => console.error("[reconciliation] handleSubscriptionPaymentConfirmed failed:", e));
    }
  } else {
    await db.payment.update({ where: { id: payment.id }, data: { status: "failed", failureCategory: "manual_resolution", failureReason: reason.slice(0, 300) } });
    if (payment.purpose === "subscription") {
      await recordFailedPayment(payment.tenantId, `Manually resolved as failed by ${admin.email}: ${reason}`);
    }
  }
  await syncReconciliationFlag(payment.tenantId);

  await logPrivilegedAction({
    admin, permission: "reconciliation.match", tenantId: payment.tenantId, action: "admin.payment_unknown_resolved",
    target: payment.reference, reason, previousState: { status: "unknown" }, newState: { status: resolution === "paid" ? "paid" : "failed" },
  });
  revalidatePath("/admin/reconciliation");
  revalidatePath("/admin/tenants");
  return { ok: true };
}
