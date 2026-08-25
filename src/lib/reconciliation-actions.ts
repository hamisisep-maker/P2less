"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { withAssertAdminPermission, logPrivilegedAction, isTenantInScope } from "./admin-authz";
import { randomToken, requestId as newRequestId } from "./crypto";
import { syncReconciliationFlag } from "./payment-channels";
import { handleSubscriptionPaymentConfirmed, recordFailedPayment } from "./billing-lifecycle";
import { settleInvoice, normalizeInvoiceRef, previewInvoiceSettlement, type SettleOutcome } from "./invoice-settlement";
import { audit } from "./audit";
import { runCrossTenant } from "./tenant-context";

// Invoice-aware manual reconciliation, 2026-08-25 — the manual-decision
// counterpart to the automatic invoice matching STK/Paybill/Card already do
// (invoicing.ts, invoice-settlement.ts). Deliberately a SEPARATE code path
// from matchUnmatchedTransactionAction/resolvePaymentUnknownAction below
// (tenant-only, recurring-bill flow) rather than a mode toggle bolted onto
// them — an explicit human decision to attach evidence to ONE specific
// invoice, never a new automatic/fuzzy matching path. See GAP-REGISTER-
// 2026-08-24.md item 9 for the full story.

const AUDIT_ACTION: Record<SettleOutcome, string | null> = {
  settled: null, insufficient: "invoice.partial_payment_received",
  already_paid: "invoice.payment_after_settlement",
  cancelled: "invoice.payment_against_cancelled_invoice",
  expired: "invoice.payment_against_expired_invoice",
  not_found: null,
};

async function auditSettleOutcome(invoiceNumber: string, tenantId: string, amountKes: number, paymentReference: string, result: Awaited<ReturnType<typeof settleInvoice>>) {
  if (result.outcome === "settled" && result.auditDetail) {
    await audit({
      tenantId: result.auditDetail.tenantId, requestId: newRequestId(), actorType: "system", action: "invoice.settled", target: result.auditDetail.invoiceNumber, success: true,
      detail: {
        invoiceNumber: result.auditDetail.invoiceNumber, fromPlan: result.auditDetail.fromPlan, toPlan: result.auditDetail.toPlan,
        remainingValueKes: result.auditDetail.remainingValueKes, payableKes: result.auditDetail.payableKes, paidTotalKes: result.auditDetail.paidTotalKes,
        connectorAllowanceChange: result.auditDetail.connectorAllowanceChange,
      },
    }).catch(() => {});
    return;
  }
  const action = AUDIT_ACTION[result.outcome];
  if (action) {
    await audit({
      tenantId, requestId: newRequestId(), actorType: "system", action, target: invoiceNumber, success: true,
      detail: { invoiceNumber, paymentReference, amountReceivedKes: amountKes, paidSoFarKes: result.paidSoFarKes ?? undefined },
    }).catch(() => {});
  }
}

/** Search candidate invoices for manual reconciliation — tenant-scoped to
 *  the admin's own authorization (never a blanket global search): a
 *  tenant-restricted admin (non-empty adminScope) only ever sees invoices
 *  within that scope, matching isTenantInScope's own convention. Never
 *  auto-selects; the admin always explicitly picks one. */
export async function searchInvoicesForReconciliationAction(query: string) {
  return withAssertAdminPermission("reconciliation.match", async (admin) => {
    const norm = normalizeInvoiceRef(query);
    if (!norm) return { results: [] as { id: string; invoiceNumber: string; tenantName: string; status: string; payableKes: number }[] };
    const scope = admin.isSuperAdmin ? null : (admin.adminScope as string[] | null | undefined);
    const invoices = await db.invoice.findMany({
      where: {
        normalizedInvoiceNumber: { contains: norm },
        ...(scope && scope.length > 0 ? { tenantId: { in: scope } } : {}),
      },
      include: { tenant: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return { results: invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, tenantName: i.tenant.name, status: i.status, payableKes: i.payableKes })) };
  });
}

/** Advisory preview only (see previewInvoiceSettlement's own comment) — same
 *  tenant-scope re-check as the write action, defense in depth even though
 *  in normal use the invoiceId only ever comes from this admin's own search
 *  results. */
export async function previewInvoiceMatchAction(invoiceId: string, incomingKes: number) {
  return withAssertAdminPermission("reconciliation.match", async (admin) => {
    const preview = await previewInvoiceSettlement(invoiceId, incomingKes);
    if (!preview) return { error: "Invoice not found." };
    if (!isTenantInScope(admin, preview.invoice.tenantId)) return { error: "Invoice outside your assigned scope." };
    return {
      ok: true as const,
      invoiceNumber: preview.invoice.invoiceNumber, tenantName: preview.invoice.tenant.name, status: preview.invoice.status,
      payableKes: preview.invoice.payableKes, paidSoFarKes: preview.paidSoFarKes, incomingKes: preview.incomingKes,
      resultingKes: preview.resultingKes, isTerminal: preview.isTerminal, wouldSettle: preview.wouldSettle,
    };
  });
}

/** Attaches an UnmatchedTransaction's evidence to ONE specific invoice —
 *  the invoice-aware counterpart to matchUnmatchedTransactionAction below.
 *  Never blocks matching against a non-awaiting_payment invoice (mirrors
 *  the automatic webhook paths, which record evidence rather than refuse)
 *  — the UI makes that consequence unmissable before the admin confirms. */
export async function matchUnmatchedTransactionToInvoiceAction(unmatchedTxId: string, invoiceId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("reconciliation.match", async (admin) => {
    const tx = await db.unmatchedTransaction.findUnique({ where: { id: unmatchedTxId } });
    if (!tx) return { error: "Transaction not found." };
    if (tx.status !== "unmatched") return { error: `This transaction is already ${tx.status}.` };

    // Fresh, never trusted from the client's earlier preview call — and the
    // real security boundary: the UI only ever shows in-scope invoices, but
    // this action must independently reject an out-of-scope invoiceId
    // submitted directly, BEFORE opening any transaction.
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return { error: "Invoice not found." };
    if (!isTenantInScope(admin, invoice.tenantId)) return { error: "Invoice outside your assigned scope." };

    const reference = "MATCH-" + randomToken(4).toUpperCase();
    let out: { payment: { id: string }; result: Awaited<ReturnType<typeof settleInvoice>> };
    try {
      out = await db.$transaction(async (dtx) => {
        const claim = await dtx.unmatchedTransaction.updateMany({ where: { id: unmatchedTxId, status: "unmatched" }, data: { status: "matched", matchedInvoiceId: invoice.id, matchedTenantId: invoice.tenantId } });
        if (claim.count === 0) throw new Error("ALREADY_RESOLVED");
        const p = await dtx.payment.create({
          data: {
            tenantId: invoice.tenantId, invoiceId: invoice.id, reference, amount: tx.amount, currency: tx.currency, purpose: "plan_change",
            method: tx.channelKey.startsWith("mpesa") ? "mpesa" : "bank", channelKey: tx.channelKey, status: "paid",
            provider: "manual", providerRef: tx.providerRef, paidAt: new Date(),
          },
        });
        // settleInvoice(id, tx) inside our own open transaction is the
        // established, production-proven pattern (Paybill/Stripe webhooks) —
        // its one internal plain-db read (getSettingNumber) is safe here.
        // What must NEVER happen inside this transaction is audit()/
        // logPrivilegedAction(), since those open their OWN nested
        // db.$transaction() for their hash-chains — that nested-transaction
        // self-block is the real cause of the Paybill deadlock bug, not a
        // plain read. Both are written after this transaction commits.
        const r = await settleInvoice(invoice.id, dtx);
        await dtx.unmatchedTransaction.update({ where: { id: unmatchedTxId }, data: { matchedPaymentId: p.id, matchedById: admin.id, matchedAt: new Date(), matchReason: reason } });
        return { payment: p, result: r };
      });
    } catch (e) {
      if (e instanceof Error && e.message === "ALREADY_RESOLVED") return { error: "This transaction is already resolved." };
      throw e;
    }

    await auditSettleOutcome(invoice.invoiceNumber, invoice.tenantId, tx.amount, reference, out.result);
    await logPrivilegedAction({
      admin, permission: "reconciliation.match", tenantId: invoice.tenantId, action: "admin.transaction_matched_to_invoice",
      target: invoice.invoiceNumber, reason, newState: { invoiceId: invoice.id, paymentId: out.payment.id, amount: tx.amount, outcome: out.result.outcome },
    });
    revalidatePath("/admin/reconciliation");
    revalidatePath("/admin/tenants");
    return { ok: true, outcome: out.result.outcome };
  });
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
  return withAssertAdminPermission("reconciliation.match", async (admin) => {
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
  });
}

/** Matches an UnmatchedTransaction to a tenant — creates the real Payment,
 *  drives it through the SAME confirmation handler a webhook would use, and
 *  records exactly who matched it, why. Never a silent/automatic match. */
export async function matchUnmatchedTransactionAction(unmatchedTxId: string, tenantId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("reconciliation.match", async (admin) => {
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
  }, { tenantId });
}

export async function ignoreUnmatchedTransactionAction(unmatchedTxId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required." };
  return withAssertAdminPermission("reconciliation.match", async (admin) => {
    const tx = await db.unmatchedTransaction.findUnique({ where: { id: unmatchedTxId } });
    if (!tx) return { error: "Transaction not found." };
    if (tx.status !== "unmatched") return { error: `This transaction is already ${tx.status}.` };
    await db.unmatchedTransaction.update({ where: { id: unmatchedTxId }, data: { status: "ignored", matchedById: admin.id, matchedAt: new Date(), matchReason: reason } });
    await logPrivilegedAction({ admin, permission: "reconciliation.match", action: "admin.unmatched_transaction_ignored", target: tx.providerRef, reason });
    revalidatePath("/admin/reconciliation");
    return { ok: true };
  });
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
  // Pre-existing bug found live during this stage's verification, not
  // introduced by it: this lookup runs before withAssertAdminPermission
  // establishes any tenant context below, so db.ts's fail-closed guard
  // (2026-08-23/24 hardening) rejected it outright — the SAME gap existed
  // for the original tenant-only resolution path, not just the new
  // invoice-aware branch. Fixed with runCrossTenant(), the same pattern
  // every webhook route already uses for this exact "resolve which tenant
  // this belongs to, before any context exists" situation.
  const payment = await runCrossTenant(() => db.payment.findUnique({ where: { id: paymentId } }));
  if (!payment) return { error: "Payment not found." };
  return withAssertAdminPermission("reconciliation.match", async (admin) => {
    if (payment.status !== "unknown") return { error: `This payment is not in an unknown state (currently "${payment.status}").` };

    if (resolution === "paid") {
      // Invoice-aware fix, 2026-08-25 — an STK-initiated invoice-centric
      // upgrade payment can genuinely land here (mpesa/callback/route.ts's
      // amount-mismatch branch). Resolving it as "paid" must settle the
      // INVOICE it belongs to, never the unrelated recurring-bill path.
      if (payment.purpose === "plan_change" && payment.invoiceId) {
        const invoiceId = payment.invoiceId;
        const result = await db.$transaction(async (dtx) => {
          await dtx.payment.update({ where: { id: payment.id }, data: { status: "paid", paidAt: new Date() } });
          // Same transaction-boundary rule as matchUnmatchedTransactionToInvoiceAction:
          // settleInvoice(id, tx) inside our own open transaction is safe;
          // audit()/logPrivilegedAction() are written only after commit.
          return settleInvoice(invoiceId, dtx);
        });
        await auditSettleOutcome(
          (await db.invoice.findUnique({ where: { id: invoiceId }, select: { invoiceNumber: true } }))?.invoiceNumber ?? invoiceId,
          payment.tenantId, payment.amount, payment.reference, result,
        );
      } else {
        await db.payment.update({ where: { id: payment.id }, data: { status: "paid", paidAt: new Date() } });
        if (payment.purpose === "subscription") {
          await handleSubscriptionPaymentConfirmed({
            id: payment.id, tenantId: payment.tenantId, reference: payment.reference, amount: payment.amount,
            currency: payment.currency, method: payment.method, periodLabel: payment.periodLabel,
          }).catch((e) => console.error("[reconciliation] handleSubscriptionPaymentConfirmed failed:", e));
        }
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
  }, { tenantId: payment.tenantId });
}
