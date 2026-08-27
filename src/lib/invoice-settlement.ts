import "server-only";
import { db } from "./db";
import { audit } from "./audit";
import { requestId as newRequestId } from "./crypto";
import { nextSequence } from "./ticket-numbering";
import { getSettingNumber } from "./platform-settings";
import type { PlanLimits } from "./usage";

// Invoice-centric paid-upgrade flow, 2026-08-25 — deliberately "server-only"
// (NOT "use server"): settleInvoice() trusts its invoiceId argument with no
// per-call tenant/permission check of its own (by design — it's meant to be
// called only from already-trusted server contexts: the STK/C2B callback
// routes, and internally from createUpgradeInvoiceAction/invoicing.ts, both
// of which establish tenant ownership before ever reaching this point).
// Keeping this in a "server-only" module makes it structurally impossible to
// import from a client component and get a callable RPC endpoint out of it.

// Derived (not imported from @prisma/client's Prisma.TransactionClient)
// because `db` is an extended client (the tenant-isolation auto-scoping
// Prisma Client Extension) — its $transaction callback's real parameter
// type isn't structurally the same as the un-extended Prisma.TransactionClient,
// which caused a real "excessive stack depth" compile error when tried.
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function loadFreshInvoice(tx: Tx | typeof db, invoiceId: string) {
  return tx.invoice.findUnique({ where: { id: invoiceId }, include: { toPlan: true, fromPlan: true, tenant: true } });
}

export async function nextInvoiceNumber(): Promise<string> {
  const seq = await nextSequence("invoice_number_seq");
  const year = new Date().getFullYear();
  return `INV-${year}-${String(seq).padStart(6, "0")}`;
}

export function normalizeInvoiceRef(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type SettleOutcome = "settled" | "insufficient" | "already_paid" | "cancelled" | "expired" | "not_found";
export type SettleResult = {
  settled: boolean;
  outcome: SettleOutcome;
  paidSoFarKes?: number;
  /** Present only when outcome === "settled" — the caller's own transaction
   *  (if any) is still open at the point settleInvoice() returns, so the
   *  "invoice.settled" audit entry can never be written from inside this
   *  function in the caller-supplied-tx case. Real bug found live: audit()
   *  opens its OWN internal db.$transaction() for its hash-chain, and SQLite
   *  only allows one writer at a time — calling it while another
   *  transaction is still open self-blocks against that same connection,
   *  consistently timing out at Prisma's default 5000ms transaction limit.
   *  settleInvoice() itself writes the audit entry when it owns the whole
   *  transaction (no tx passed in); when a caller supplies tx, THAT caller
   *  must write it, after their own transaction has actually committed,
   *  using this payload. */
  auditDetail?: { tenantId: string; invoiceNumber: string; fromPlan: string; toPlan: string; remainingValueKes: number; payableKes: number; paidTotalKes: number; connectorAllowanceChange: { from: number | null; to: number | null } | null; messageTopupMessages: number; messageTopupKes: number };
};

/** The ONE place that resolves what an invoice's current state means and
 *  whether it's paid — Paybill/STK 2026-08-25 review: "identifying an
 *  invoice" and "deciding whether that invoice can currently accept a
 *  settlement" are separate questions, resolved here in order, always:
 *
 *  1. paid / cancelled -> real terminal states, any further money against
 *     them is evidence of a duplicate/late payment, never a second upgrade.
 *  2. awaiting_payment past invoice_expiry_hours -> the real "expired"
 *     status is WRITTEN here (previously only ever computed on the fly at
 *     read time in createUpgradeInvoiceAction/initiateInvoiceStkPaymentAction,
 *     never persisted — single source of truth now).
 *  3. genuinely awaiting_payment, not expired -> sum every "paid" Payment
 *     against this invoice (fresh, inside the transaction) and only settle
 *     once that sum >= payableKes. This is what makes Paybill's partial/
 *     multi-payment reality safe: two near-simultaneous partial payments
 *     each independently re-sum ALL paid payments at their own call time,
 *     and the compare-and-swap `updateMany` on Invoice.status ensures only
 *     one of them can ever win the actual awaiting_payment -> paid
 *     transition, however the sums land. Excess beyond payableKes is never
 *     applied anywhere else (no message/AI balance, no future-invoice
 *     credit) — forfeited, consistent with the already-decided rule.
 *
 *  Backward-compatible with STK's already-shipped, already-verified single-
 *  exact-payment case: one Payment whose amount equals payableKes makes the
 *  sum check pass trivially on the first call, zero behavior change.
 *
 *  Pass `tx` when the caller wants the Payment-creation and this settlement
 *  decision to commit or roll back together as one atomic unit (the Paybill
 *  C2B route does this, since it writes payment evidence and calls this in
 *  the same request) — in that mode the CALLER is responsible for writing
 *  the "invoice.settled" audit entry once their own transaction has
 *  actually committed (see auditDetail above). Omitted, this opens its own
 *  transaction and writes that audit entry itself — used by the STK
 *  callback (which already committed the Payment status update earlier in
 *  that route) and the zero-payable auto-settle path. */
export async function settleInvoice(invoiceId: string, tx?: Tx): Promise<SettleResult> {
  // Resolved BEFORE any transaction opens, always — getSettingNumber() uses
  // the plain outer `db` client, not `tx`. Calling it from inside an open
  // transaction hit the exact same self-blocking stall described above.
  const expiryHours = await getSettingNumber("invoice_expiry_hours");

  if (tx) return settleInvoiceInTx(tx, invoiceId, expiryHours);

  const result = await db.$transaction((innerTx) => settleInvoiceInTx(innerTx, invoiceId, expiryHours));
  if (result.outcome === "settled" && result.auditDetail) {
    await audit({
      tenantId: result.auditDetail.tenantId, requestId: newRequestId(), actorType: "system",
      action: "invoice.settled", target: result.auditDetail.invoiceNumber, success: true,
      detail: {
        invoiceNumber: result.auditDetail.invoiceNumber, fromPlan: result.auditDetail.fromPlan, toPlan: result.auditDetail.toPlan,
        remainingValueKes: result.auditDetail.remainingValueKes, payableKes: result.auditDetail.payableKes, paidTotalKes: result.auditDetail.paidTotalKes,
        connectorAllowanceChange: result.auditDetail.connectorAllowanceChange,
        messageTopupMessages: result.auditDetail.messageTopupMessages, messageTopupKes: result.auditDetail.messageTopupKes,
      },
    }).catch(() => {});
  }
  return { settled: result.settled, outcome: result.outcome, paidSoFarKes: result.paidSoFarKes };
}

async function settleInvoiceInTx(tx: Tx, invoiceId: string, expiryHours: number): Promise<SettleResult> {
  const before = await loadFreshInvoice(tx, invoiceId);
  if (!before) return { settled: false, outcome: "not_found" };

  if (before.status === "paid") return { settled: false, outcome: "already_paid" };
  if (before.status === "cancelled") return { settled: false, outcome: "cancelled" };

  if (before.status === "expired") return { settled: false, outcome: "expired" };
  if (before.status === "awaiting_payment") {
    if (before.createdAt.getTime() < Date.now() - expiryHours * 60 * 60 * 1000) {
      await tx.invoice.updateMany({ where: { id: invoiceId, status: "awaiting_payment" }, data: { status: "expired" } });
      return { settled: false, outcome: "expired" };
    }
  } else {
    // Defensive — every real status is handled above; an unrecognized value
    // is treated as not-currently-settleable rather than guessed at.
    return { settled: false, outcome: "not_found" };
  }

  const paidSoFar = (await tx.payment.aggregate({ where: { invoiceId, status: "paid" }, _sum: { amount: true } }))._sum.amount ?? 0;
  if (paidSoFar < before.payableKes) {
    return { settled: false, outcome: "insufficient", paidSoFarKes: paidSoFar };
  }

  const now = new Date();
  const claim = await tx.invoice.updateMany({
    where: { id: invoiceId, status: "awaiting_payment" },
    data: { status: "paid", paidAt: now, appliedAt: now },
  });
  if (claim.count === 0) {
    // Lost the compare-and-swap race to a concurrent settlement — the other
    // caller already applied it. Safe no-op, not a second upgrade.
    return { settled: false, outcome: "already_paid" };
  }
  await tx.subscription.update({
    where: { tenantId: before.tenantId },
    data: {
      planId: before.toPlanId, pendingPlanId: null,
      // Real message-balance top-up bundled into this same payment,
      // 2026-08-27 — credited only now, once payment has actually settled,
      // same "money moves only when it's real" rule the plan change itself
      // follows. A no-op increment(0) when no top-up was purchased.
      ...(before.messageTopupKes > 0 ? { messageBalanceKes: { increment: before.messageTopupKes } } : {}),
    },
  });

  const oldLimits = (before.fromPlan?.limits as PlanLimits | undefined) ?? {};
  const newLimits = (before.toPlan.limits as PlanLimits | undefined) ?? {};
  const connectorChange = oldLimits.connectors !== newLimits.connectors;
  return {
    settled: true, outcome: "settled",
    auditDetail: {
      tenantId: before.tenantId, invoiceNumber: before.invoiceNumber,
      fromPlan: before.fromPlan?.name ?? "(trial)", toPlan: before.toPlan.name,
      remainingValueKes: before.remainingValueKes, payableKes: before.payableKes, paidTotalKes: paidSoFar,
      connectorAllowanceChange: connectorChange ? { from: oldLimits.connectors ?? null, to: newLimits.connectors ?? null } : null,
      messageTopupMessages: before.messageTopupMessages, messageTopupKes: before.messageTopupKes,
    },
  };
}

export async function loadFreshInvoiceForAction(invoiceId: string) {
  return loadFreshInvoice(db, invoiceId);
}

/** Advisory only — manual-reconciliation UI (2026-08-25). Reuses the exact
 *  same "sum of paid Payments vs payableKes" threshold settleInvoiceInTx
 *  applies, so this preview can never drift from what actually happens. It
 *  is NOT the authority: an admin's UI can show this and then submit
 *  minutes later, by which point the invoice's real state may have moved —
 *  the write path (matchUnmatchedTransactionToInvoiceAction /
 *  resolvePaymentUnknownAction) always reloads fresh and calls the real
 *  settleInvoice() again regardless of what this returned. */
export async function previewInvoiceSettlement(invoiceId: string, incomingKes: number) {
  const invoice = await loadFreshInvoice(db, invoiceId);
  if (!invoice) return null;
  const paidSoFarKes = (await db.payment.aggregate({ where: { invoiceId, status: "paid" }, _sum: { amount: true } }))._sum.amount ?? 0;
  const resultingKes = paidSoFarKes + incomingKes;
  return {
    invoice, paidSoFarKes, incomingKes, resultingKes,
    isTerminal: invoice.status !== "awaiting_payment",
    wouldSettle: invoice.status === "awaiting_payment" && resultingKes >= invoice.payableKes,
  };
}
