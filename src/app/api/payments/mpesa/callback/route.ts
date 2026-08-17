import { db } from "@/lib/db";
import { parseCallback } from "@/lib/mpesa";
import { dispatchWebhook } from "@/lib/webhooks";
import { creditsForAmount } from "@/lib/wallet";

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
      }
    }
  }
  // Always 200 so Safaricom doesn't retry.
  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
