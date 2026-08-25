import "server-only";
import { db } from "./db";
import { audit } from "./audit";
import { requestId as newRequestId } from "./crypto";
import { nextSequence } from "./ticket-numbering";
import type { PlanLimits } from "./usage";

// Invoice-centric paid-upgrade flow, 2026-08-25 — deliberately "server-only"
// (NOT "use server"): settleInvoice() trusts its invoiceId argument with no
// per-call tenant/permission check of its own (by design — it's meant to be
// called only from already-trusted server contexts: the STK callback route,
// and internally from createUpgradeInvoiceAction/invoicing.ts, both of which
// establish tenant ownership before ever reaching this point). Keeping this
// in a "server-only" module makes it structurally impossible to import from
// a client component and get a callable RPC endpoint out of it — not just a
// convention to remember, a build-time guarantee. See invoicing.ts for the
// two functions that ARE meant to be client-callable Server Actions.

async function loadFreshInvoice(invoiceId: string) {
  return db.invoice.findUnique({ where: { id: invoiceId }, include: { toPlan: true, fromPlan: true, tenant: true } });
}

export async function nextInvoiceNumber(): Promise<string> {
  const seq = await nextSequence("invoice_number_seq");
  const year = new Date().getFullYear();
  return `INV-${year}-${String(seq).padStart(6, "0")}`;
}

/** The ONE function that ever transitions an invoice to "paid" and applies
 *  the plan change. Idempotent and concurrency-safe: the status transition
 *  itself is the compare-and-swap lock (`updateMany` with a `status:
 *  "awaiting_payment"` guard, inside a transaction) — a duplicate callback,
 *  a second browser tab, or two concurrent zero-payable settlements all
 *  race for the SAME conditional update, and only one can ever win it. A
 *  loser (0 rows affected) is a safe, silent no-op — exactly "a paid
 *  invoice cannot trigger a second upgrade." Payment identity (reference/
 *  method/providerRef) is recorded as evidence on the Invoice's Payment
 *  rows, never re-used to decide WHETHER to settle — that's the invoice's
 *  own status alone. */
export async function settleInvoice(invoiceId: string): Promise<{ settled: boolean; alreadySettled: boolean }> {
  const before = await loadFreshInvoice(invoiceId);
  if (!before) return { settled: false, alreadySettled: false };
  if (before.status !== "awaiting_payment") return { settled: false, alreadySettled: true };

  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    const claim = await tx.invoice.updateMany({
      where: { id: invoiceId, status: "awaiting_payment" },
      data: { status: "paid", paidAt: now, appliedAt: now },
    });
    if (claim.count === 0) return { won: false };
    await tx.subscription.update({
      where: { tenantId: before.tenantId },
      data: { planId: before.toPlanId, pendingPlanId: null },
    });
    return { won: true };
  });
  if (!result.won) return { settled: false, alreadySettled: true };

  // Best-effort, outside the core financial transaction — mirrors this
  // codebase's established pattern (billing-lifecycle.ts's billingAudit
  // calls always happen AFTER the core state change, never inside the same
  // transaction; audit() opens its own transaction internally for the
  // hash-chain, which cannot nest inside another).
  const oldLimits = (before.fromPlan?.limits as PlanLimits | undefined) ?? {};
  const newLimits = (before.toPlan.limits as PlanLimits | undefined) ?? {};
  const connectorChange = oldLimits.connectors !== newLimits.connectors;
  await audit({
    tenantId: before.tenantId, requestId: newRequestId(), actorType: "system",
    action: "invoice.settled", target: before.invoiceNumber, success: true,
    detail: {
      invoiceNumber: before.invoiceNumber, fromPlan: before.fromPlan?.name ?? "(trial)", toPlan: before.toPlan.name,
      remainingValueKes: before.remainingValueKes, payableKes: before.payableKes,
      connectorAllowanceChange: connectorChange ? { from: oldLimits.connectors ?? null, to: newLimits.connectors ?? null } : null,
    },
  }).catch(() => {});
  return { settled: true, alreadySettled: false };
}

export async function loadFreshInvoiceForAction(invoiceId: string) {
  return loadFreshInvoice(invoiceId);
}
