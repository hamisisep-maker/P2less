import { db } from "@/lib/db";
import { parseCallback, classifyMpesaFailure } from "@/lib/mpesa";
import { dispatchWebhook } from "@/lib/webhooks";
import { creditsForAmount } from "@/lib/wallet";
import { sendWhatsAppText } from "@/lib/transport";
import { tryAssignTrip } from "@/lib/dispatch";
import { handleSubscriptionPaymentConfirmed, handleSubscriptionPaymentFailed } from "@/lib/billing-lifecycle";
import { recordInboundEvent, finishInboundEvent } from "@/lib/inbound-events";
import { recordChannelOutcome, recordChannelCallback, syncReconciliationFlag } from "@/lib/payment-channels";
import { enterTenantContext, runCrossTenant } from "@/lib/tenant-context";

// Safaricom Daraja posts the final STK-push result here. We match it to the
// pending Payment by CheckoutRequestID and mark it paid or failed. Every
// delivery is logged as a real InboundEvent BEFORE processing — a
// unique-constraint violation on the idempotency key is the honest signal
// that Safaricom re-delivered the same callback, and we stop right there
// instead of re-running side effects (wallet credit, order fulfillment, ...).
export async function POST(req: Request) {
  const startedAt = Date.now();
  const rawBody = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
  const parsed = parseCallback(body);
  const eventRecord = await recordInboundEvent({ source: "mpesa_stk_callback", eventId: parsed?.checkoutId, rawBody });
  if (eventRecord.duplicate) {
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
  await recordChannelCallback("mpesa_stk");

  let relatedPaymentId: string | undefined;
  let relatedTenantId: string | undefined;
  let matched = false;

  if (parsed) {
    // Deliberately cross-tenant — resolves WHICH tenant this callback
    // belongs to, before any context can exist. Found in the same
    // 2026-08-23 fail-closed audit as every other webhook's own lookup.
    const payment = await runCrossTenant(() => db.payment.findFirst({ where: { providerRef: parsed.checkoutId } }));
    // Accept a genuinely late callback even after the reconciliation sweep
    // already flipped this payment to "unknown" — previously only "pending"
    // was accepted, so a real-but-late webhook arriving after that point was
    // silently dropped and could ONLY ever be cleared by a human, even though
    // Safaricom's own definitive answer had actually arrived.
    if (payment && (payment.status === "pending" || payment.status === "unknown")) {
      matched = true;
      relatedPaymentId = payment.id;
      relatedTenantId = payment.tenantId;
      // Tenant-isolation hardening — same pattern as every channel webhook:
      // the payment lookup above resolves which tenant this callback belongs
      // to, everything downstream runs scoped to it.
      enterTenantContext(payment.tenantId);
      const wasUnknown = payment.status === "unknown";
      await recordChannelOutcome("mpesa_stk", parsed.success);
      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: parsed.success ? "paid" : "failed",
          paidAt: parsed.success ? new Date() : null,
          providerRef: parsed.receipt ?? parsed.checkoutId,
          failureCategory: parsed.success ? null : classifyMpesaFailure(parsed.desc),
          failureReason: parsed.success ? null : (parsed.desc ?? "").slice(0, 300),
        },
      });
      if (wasUnknown) await syncReconciliationFlag(payment.tenantId).catch(() => {});
      if (parsed.success) {
        void dispatchWebhook(payment.tenantId, "payment.paid", { reference: payment.reference, amount: payment.amount, currency: payment.currency, receipt: parsed.receipt }).catch(() => {});
        // Wallet top-up: credit the CONTACT's balance now that M-Pesa confirmed it.
        if (payment.purpose === "topup" && payment.contactId) {
          const credits = creditsForAmount(payment.amount);
          await db.contact.update({ where: { id: payment.contactId }, data: { credits: { increment: credits } } });
        }
        // Subscription renewal: the real event that drives the billing
        // lifecycle forward — reactivates a suspended/grace-period tenant,
        // extends renewsAt, generates a real receipt. See billing-lifecycle.ts.
        if (payment.purpose === "subscription") {
          await handleSubscriptionPaymentConfirmed({
            id: payment.id, tenantId: payment.tenantId, reference: payment.reference,
            amount: payment.amount, currency: payment.currency, method: payment.method, periodLabel: payment.periodLabel,
          }).catch((e) => console.error("[billing] handleSubscriptionPaymentConfirmed failed:", e));
        }
        // Product order: mark it paid and let the customer know on WhatsApp —
        // this confirmation arrives asynchronously (the STK prompt already
        // returned before the customer even entered their PIN), so without this
        // they'd have no way to know the purchase actually went through.
        if (payment.purpose === "order" && payment.orderId) {
          const order = await db.order.update({
            where: { id: payment.orderId },
            data: { status: "paid", paidAt: new Date() },
            include: { contact: true, tenant: { include: { numbers: true } }, items: true },
          });
          const orgNumber = order.tenant.numbers.find((n) => n.status === "active");
          const isDelivery = order.fulfillment === "delivery";
          if (orgNumber?.phoneNumberId) {
            const itemsLine = order.items.map((i) => `${i.quantity} × ${i.name}`).join(", ");
            const driverNote = isDelivery ? " Looking for a driver now — I'll update you as soon as one is confirmed." : "";
            await sendWhatsAppText(orgNumber.phoneNumberId, order.contact.address, `✅ Payment received! Your order ${order.reference} is confirmed — ${itemsLine}. Total: ${order.currency} ${order.totalAmount.toLocaleString("en-US")}. Thank you! 🎉${driverNote}`);
          }
          // Only NOW that payment is genuinely confirmed do we start looking for
          // a driver — never before, so a failed/abandoned STK push never wastes
          // a driver's time on an order that was never actually paid for.
          if (isDelivery) {
            const trip = await db.deliveryTrip.create({ data: { tenantId: order.tenantId, orderId: order.id, status: "searching" } });
            void tryAssignTrip(trip.id).catch(() => {});
          }
        }
      } else if (payment.purpose === "order" && payment.orderId) {
        // Payment genuinely failed (e.g. the customer never entered their PIN)
        // — the stock hold taken at CONFIRM time was never consumed, so give it
        // back rather than leaving the shop permanently a unit short for a sale
        // that never happened.
        const items = await db.orderItem.findMany({ where: { orderId: payment.orderId } });
        for (const item of items) {
          await db.product.update({ where: { id: item.productId }, data: { stockQuantity: { increment: item.quantity } } }).catch(() => {});
        }
        await db.order.update({ where: { id: payment.orderId }, data: { status: "failed" } }).catch(() => {});
      } else if (payment.purpose === "subscription") {
        // A DEFINITIVE failure from Safaricom (not "no callback yet" — that
        // ambiguous case is caught separately by the billing poller's
        // reconciliation check) — real evidence, so it's safe to advance the
        // retry/grace-period machinery.
        await handleSubscriptionPaymentFailed({ tenantId: payment.tenantId, reference: payment.reference }, parsed.desc ?? "Daraja reported failure")
          .catch((e) => console.error("[billing] handleSubscriptionPaymentFailed failed:", e));
      }
    }
  }
  await finishInboundEvent(eventRecord.eventRecordId, {
    processingStatus: matched ? "processed" : "reconciliation_required",
    startedAt, responseStatus: 200, relatedPaymentId, relatedTenantId,
  });
  // Always 200 so Safaricom doesn't retry.
  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
