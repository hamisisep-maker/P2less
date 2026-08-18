import { db } from "@/lib/db";
import { parseCallback } from "@/lib/mpesa";
import { dispatchWebhook } from "@/lib/webhooks";
import { creditsForAmount } from "@/lib/wallet";
import { sendWhatsAppText } from "@/lib/transport";
import { tryAssignTrip } from "@/lib/dispatch";

// Safaricom Daraja posts the final STK-push result here. We match it to the
// pending Payment by CheckoutRequestID and mark it paid or failed.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
  const parsed = parseCallback(body);
  if (parsed) {
    const payment = await db.payment.findFirst({ where: { providerRef: parsed.checkoutId } });
    if (payment && payment.status === "pending") {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: parsed.success ? "paid" : "failed",
          paidAt: parsed.success ? new Date() : null,
          providerRef: parsed.receipt ?? parsed.checkoutId,
        },
      });
      if (parsed.success) {
        void dispatchWebhook(payment.tenantId, "payment.paid", { reference: payment.reference, amount: payment.amount, currency: payment.currency, receipt: parsed.receipt }).catch(() => {});
        // Wallet top-up: credit the CONTACT's balance now that M-Pesa confirmed it.
        if (payment.purpose === "topup" && payment.contactId) {
          const credits = creditsForAmount(payment.amount);
          await db.contact.update({ where: { id: payment.contactId }, data: { credits: { increment: credits } } });
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
      }
    }
  }
  // Always 200 so Safaricom doesn't retry.
  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
