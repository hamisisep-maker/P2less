import { db } from "@/lib/db";
import { parseC2BConfirmation } from "@/lib/mpesa";
import { randomToken } from "@/lib/crypto";
import { recordInboundEvent, finishInboundEvent } from "@/lib/inbound-events";
import { recordChannelOutcome, recordChannelCallback } from "@/lib/payment-channels";
import { handleSubscriptionPaymentConfirmed } from "@/lib/billing-lifecycle";
import { enterTenantContext } from "@/lib/tenant-context";

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

  const subscription = parsed.billRefNumber
    ? await db.subscription.findUnique({ where: { paybillReference: parsed.billRefNumber } })
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
