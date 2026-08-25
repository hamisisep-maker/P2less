import { db } from "@/lib/db";
import { constructWebhookEvent } from "@/lib/stripe";
import { recordInboundEvent, finishInboundEvent } from "@/lib/inbound-events";
import { settleInvoice, type SettleOutcome } from "@/lib/invoice-settlement";
import { audit } from "@/lib/audit";
import { requestId as newRequestId } from "@/lib/crypto";
import { enterTenantContext, runCrossTenant } from "@/lib/tenant-context";

// Stripe webhook — the invoice-centric flow's third and last payment method
// (after STK and Paybill), converging on the same settleInvoice() authority.
// Unlike Safaricom's callbacks (unauthenticated, confirmed elsewhere in this
// codebase), Stripe REQUIRES verifying the Stripe-Signature header over the
// raw body — a bad signature here is a real attack surface, rejected with
// 400, never swallowed as 200 the way a malformed M-Pesa payload is.
export async function POST(req: Request) {
  const startedAt = Date.now();
  const rawBody = await req.text();
  const event = constructWebhookEvent(rawBody, req.headers.get("stripe-signature"));
  if (!event) return new Response("Invalid signature", { status: 400 });

  const eventRecord = await recordInboundEvent({ source: "stripe_webhook", eventId: event.id, rawBody });
  if (eventRecord.duplicate) {
    return Response.json({ received: true });
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as { client_reference_id?: string | null; id: string };
    const invoiceId = session.client_reference_id;
    if (invoiceId) {
      const invoice = await runCrossTenant(() => db.invoice.findUnique({ where: { id: invoiceId } }));
      if (invoice) {
        enterTenantContext(invoice.tenantId);
        // Customer abandoned checkout — the pending Payment failed, clear
        // the lock so a retry can create a fresh session (same shape as
        // STK's failure path).
        await db.payment.updateMany({
          where: { invoiceId, channelKey: "card", status: "pending" },
          data: { status: "failed", invoicePendingKey: null, failureCategory: "user_cancellation", failureReason: "Checkout session expired" },
        });
      }
    }
    await finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "processed", startedAt, responseStatus: 200 });
    return Response.json({ received: true });
  }

  if (event.type !== "checkout.session.completed") {
    // Other event types Stripe sends by default that this integration
    // doesn't act on yet — acknowledged, not an error.
    await finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "processed", startedAt, responseStatus: 200 });
    return Response.json({ received: true });
  }

  const session = event.data.object as { id: string; client_reference_id?: string | null; metadata?: { invoiceId?: string } | null; amount_total?: number | null; payment_intent?: string | null };
  // Both fields checked — client_reference_id is Stripe's own purpose-built
  // field for this; metadata.invoiceId is a second independent read of the
  // same value set at creation time (createCheckoutSession, stripe.ts).
  const invoiceId = session.client_reference_id || session.metadata?.invoiceId;

  let relatedPaymentId: string | undefined;
  let relatedTenantId: string | undefined;

  if (!invoiceId) {
    await finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "reconciliation_required", startedAt, responseStatus: 200, error: "checkout.session.completed with no invoice reference" });
    return Response.json({ received: true });
  }

  // Deliberately cross-tenant — resolves WHICH tenant this session belongs
  // to, before any context can exist. Same pattern every other webhook here
  // uses.
  const invoice = await runCrossTenant(() => db.invoice.findUnique({ where: { id: invoiceId } }));
  if (!invoice) {
    // Missing here would mean OUR OWN metadata was wrong at creation time —
    // a real bug signal, not a customer-typo case like Paybill's unmatched
    // references. Never guessed, never dropped — held for reconciliation.
    await finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "reconciliation_required", startedAt, responseStatus: 200, error: `checkout.session.completed referenced unknown invoice ${invoiceId}` });
    return Response.json({ received: true });
  }
  enterTenantContext(invoice.tenantId);
  relatedTenantId = invoice.tenantId;

  const pending = await db.payment.findFirst({ where: { invoiceId, channelKey: "card", status: "pending" }, orderBy: { createdAt: "desc" } });
  const amountReceivedKes = (session.amount_total ?? 0) / 100;

  // Defensive cross-check — Stripe's own Checkout Session amount was set BY
  // US at creation time (never customer-entered, unlike Paybill), so a
  // mismatch here would mean tampering or a bug, not a legitimate different-
  // amount scenario. Logged, never silently trusted either way.
  if (pending && Math.round(pending.amount) !== Math.round(amountReceivedKes)) {
    console.error(`[stripe-webhook] amount mismatch for invoice ${invoice.invoiceNumber}: pending Payment ${pending.amount} KES vs session amount_total ${amountReceivedKes} KES`);
  }

  const payment = pending
    ? await db.payment.update({
        where: { id: pending.id },
        data: { status: "paid", paidAt: new Date(), providerRef: (session.payment_intent as string) ?? session.id, invoicePendingKey: null, amount: amountReceivedKes || pending.amount },
      })
    : await db.payment.create({
        data: {
          tenantId: invoice.tenantId, invoiceId: invoice.id, reference: "CARD-" + session.id.slice(-8).toUpperCase(),
          amount: amountReceivedKes, currency: invoice.currency, purpose: "plan_change", method: "card", channelKey: "card",
          status: "paid", provider: "stripe", providerRef: (session.payment_intent as string) ?? session.id, paidAt: new Date(),
        },
      });
  relatedPaymentId = payment.id;

  const result = await settleInvoice(invoice.id);

  if (result.outcome === "settled" && result.auditDetail) {
    await audit({
      tenantId: result.auditDetail.tenantId, requestId: newRequestId(), actorType: "system",
      action: "invoice.settled", target: result.auditDetail.invoiceNumber, success: true,
      detail: {
        invoiceNumber: result.auditDetail.invoiceNumber, fromPlan: result.auditDetail.fromPlan, toPlan: result.auditDetail.toPlan,
        remainingValueKes: result.auditDetail.remainingValueKes, payableKes: result.auditDetail.payableKes, paidTotalKes: result.auditDetail.paidTotalKes,
        connectorAllowanceChange: result.auditDetail.connectorAllowanceChange,
      },
    }).catch(() => {});
  } else {
    const AUDIT_ACTION: Record<SettleOutcome, string | null> = {
      settled: null, insufficient: "invoice.partial_payment_received",
      already_paid: "invoice.payment_after_settlement",
      cancelled: "invoice.payment_against_cancelled_invoice",
      expired: "invoice.payment_against_expired_invoice",
      not_found: null,
    };
    const action = AUDIT_ACTION[result.outcome];
    if (action) {
      await audit({
        tenantId: invoice.tenantId, requestId: newRequestId(), actorType: "system", action, target: invoice.invoiceNumber, success: true,
        detail: { invoiceNumber: invoice.invoiceNumber, paymentReference: payment.reference, amountReceivedKes, payableKes: invoice.payableKes, paidSoFarKes: result.paidSoFarKes ?? undefined },
      }).catch(() => {});
    }
  }

  await finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "processed", startedAt, responseStatus: 200, relatedPaymentId, relatedTenantId });
  return Response.json({ received: true });
}
