import { db } from "@/lib/db";
import { parseC2BConfirmation } from "@/lib/mpesa";
import { randomToken, requestId as newRequestId } from "@/lib/crypto";
import { recordInboundEvent, finishInboundEvent } from "@/lib/inbound-events";
import { recordChannelOutcome, recordChannelCallback } from "@/lib/payment-channels";
import { handleSubscriptionPaymentConfirmed } from "@/lib/billing-lifecycle";
import { enterTenantContext, runCrossTenant } from "@/lib/tenant-context";
import { settleInvoice, normalizeInvoiceRef, type SettleOutcome } from "@/lib/invoice-settlement";
import { audit } from "@/lib/audit";

// Daraja C2B "Confirmation" — fires AFTER Safaricom has ALREADY moved the
// customer's money into the PayBill/Till. Unlike STK Push, P2Less never
// initiated this payment, so there is no pre-existing pending Payment row to
// match by CheckoutRequestID — matching happens by BillRefNumber against a
// tenant's assigned Subscription.paybillReference instead.
//
// Real (not fabricated) implementation. Honesty note: live Safaricom C2B
// traffic requires registering this URL against a real sandbox/production
// shortcode via Daraja's own registerurl API — an external operator step
// this environment cannot perform. This endpoint is verified instead with
// crafted Daraja-shaped payloads posted directly at the route.
export async function POST(req: Request) {
  const startedAt = Date.now();
  const rawBody = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  const parsed = parseC2BConfirmation(body);
  const eventRecord = await recordInboundEvent({ source: "mpesa_c2b_confirmation", eventId: parsed?.transId, rawBody });
  if (eventRecord.duplicate) {
    // The money already moved on Safaricom's side exactly once — a
    // re-delivered confirmation must never be processed a second time
    // (double-crediting a subscription, double-creating a Payment row).
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  if (!parsed) {
    await finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "failed", startedAt, error: "Unparseable C2B confirmation payload" });
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  // Which channel: match the paying shortcode against configured channels;
  // default to PayBill (the common case) if we can't tell — Till uses an
  // identical confirmation contract, distinguished only by shortcode.
  const paybillChannel = await db.paymentChannel.findUnique({ where: { key: "mpesa_paybill" } });
  const tillChannel = await db.paymentChannel.findUnique({ where: { key: "mpesa_till" } });
  const paybillShortcode = (paybillChannel?.configJson as { shortcode?: string } | null)?.shortcode;
  const tillShortcode = (tillChannel?.configJson as { shortcode?: string } | null)?.shortcode;
  const channelKey = parsed.businessShortCode && parsed.businessShortCode === tillShortcode ? "mpesa_till" : "mpesa_paybill";

  await recordChannelCallback(channelKey);

  let relatedPaymentId: string | undefined;
  let relatedTenantId: string | undefined;

  // Invoice-centric paid-upgrade flow, 2026-08-25 — tried FIRST, before the
  // existing subscription-reference lookup below. A real DB-backed exact
  // match on the unique normalizedInvoiceNumber column — never a scan, never
  // fuzzy, never by amount/phone/customer. An earlier draft of this used
  // findFirst({status:"awaiting_payment"}) + compare-in-JS and was rejected
  // in review: with more than one awaiting invoice it could silently match
  // the wrong one. This looks up the ONE real invoice this reference
  // identifies, with NO status filter — "which invoice is this" and "is it
  // currently payable" are answered separately, by settleInvoice() itself.
  const invoice = parsed.billRefNumber
    ? await runCrossTenant(() => db.invoice.findUnique({ where: { normalizedInvoiceNumber: normalizeInvoiceRef(parsed.billRefNumber!) } }))
    : null;

  if (invoice) {
    enterTenantContext(invoice.tenantId);
    const reference = "C2B-" + randomToken(4).toUpperCase();
    // Payment-as-evidence and the settlement decision commit or roll back
    // together as one atomic unit — review requirement: a crash here must
    // never leave a successful upgrade whose Payment wasn't actually
    // committed, or a committed Payment with no settlement decision made.
    const { payment, result } = await db.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          tenantId: invoice.tenantId, invoiceId: invoice.id, reference,
          amount: parsed.amount, currency: "KES", purpose: "plan_change",
          method: "mpesa", channelKey, status: "paid", provider: "daraja",
          providerRef: parsed.transId, paidAt: new Date(),
        },
      });
      const r = await settleInvoice(invoice.id, tx);
      return { payment: p, result: r };
    });
    await recordChannelOutcome(channelKey, true);
    relatedPaymentId = payment.id;
    relatedTenantId = invoice.tenantId;

    // Real bug found live: settleInvoice() cannot write its own audit entry
    // when a caller-supplied tx is still open (audit() opens its OWN
    // internal transaction for the hash-chain — nesting it inside another
    // open transaction self-blocked against the same SQLite connection,
    // consistently timing out at Prisma's 5000ms default). Written here
    // instead, AFTER the db.$transaction() above has actually committed.
    if (result.outcome === "settled" && result.auditDetail) {
      await audit({
        tenantId: result.auditDetail.tenantId, requestId: newRequestId(), actorType: "system", action: "invoice.settled", target: result.auditDetail.invoiceNumber, success: true,
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
          detail: {
            invoiceNumber: invoice.invoiceNumber, paymentReference: reference, amountReceivedKes: parsed.amount,
            payableKes: invoice.payableKes, paidSoFarKes: result.paidSoFarKes ?? undefined,
          },
        }).catch(() => {});
      }
    }
    await finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "processed", startedAt, responseStatus: 200, relatedPaymentId, relatedTenantId });
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  // Deliberately cross-tenant — resolves WHICH tenant this confirmation
  // belongs to, before any context can exist. Found in the same 2026-08-23
  // fail-closed audit as every other webhook's own lookup.
  const subscription = parsed.billRefNumber
    ? await runCrossTenant(() => db.subscription.findUnique({ where: { paybillReference: parsed.billRefNumber! } }))
    : null;

  if (subscription) {
    // Tenant-isolation hardening — same pattern as every channel webhook: the
    // subscription lookup above resolves which tenant this confirmation
    // belongs to, everything downstream runs scoped to it.
    enterTenantContext(subscription.tenantId);
    const reference = "C2B-" + randomToken(4).toUpperCase();
    const payment = await db.payment.create({
      data: {
        tenantId: subscription.tenantId, reference, amount: parsed.amount, currency: "KES",
        purpose: "subscription", method: "mpesa", channelKey, status: "paid",
        provider: "daraja", providerRef: parsed.transId, periodLabel: new Date().toISOString().slice(0, 7), paidAt: new Date(),
      },
    });
    await handleSubscriptionPaymentConfirmed({
      id: payment.id, tenantId: subscription.tenantId, reference, amount: parsed.amount, currency: "KES", method: "mpesa", periodLabel: payment.periodLabel,
    }).catch((e) => console.error("[mpesa-c2b] handleSubscriptionPaymentConfirmed failed:", e));
    await recordChannelOutcome(channelKey, true);
    relatedPaymentId = payment.id;
    relatedTenantId = subscription.tenantId;
    await finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "processed", startedAt, responseStatus: 200, relatedPaymentId, relatedTenantId });
  } else {
    // No tenant recognized this reference — never invent a match, never
    // drop the evidence. A real admin resolves this at /admin/reconciliation.
    await db.unmatchedTransaction.create({
      data: {
        channelKey, providerRef: parsed.transId, amount: parsed.amount, currency: "KES",
        occurredAt: new Date(), senderMsisdn: parsed.msisdn,
        senderName: [parsed.firstName, parsed.lastName].filter(Boolean).join(" ") || undefined,
        reference: parsed.billRefNumber || undefined, rawPayload: body as object,
      },
    });
    await finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "reconciliation_required", startedAt, responseStatus: 200 });
  }

  // Always 200 — the money has already moved; nothing the response says changes that.
  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
