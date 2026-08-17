import "server-only";
import { db } from "./db";
import { stkPush, isConfigured } from "./mpesa";
import { randomToken } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Super-app WALLET — per-CONTACT credits (distinct from the org-level billing in
// billing.ts, which is per-TENANT). Contacts spend credits per tool use and top
// up with M-Pesa STK push, reusing the same Daraja integration as org billing.
// ─────────────────────────────────────────────────────────────────────────────

/** How many KES buys one credit. Override via TOOL_CREDIT_KES. */
export function creditRateKes(): number {
  return Number(process.env.TOOL_CREDIT_KES || 2);
}

export function creditsForAmount(amountKes: number): number {
  return Math.max(1, Math.floor(amountKes / creditRateKes()));
}

export type TopupResult =
  | { ok: true; mock: true; credits: number; newBalance: number }
  | { ok: true; mock: false; reference: string; customerMessage: string }
  | { ok: false; error: string };

/** Start a wallet top-up: real M-Pesa STK push if configured, else an instant
 *  mock credit (so the demo — and local dev — always works end to end). */
export async function startTopup(opts: { tenantId: string; contactId: string; phone: string; amountKes: number }): Promise<TopupResult> {
  const credits = creditsForAmount(opts.amountKes);
  const reference = "TOPUP-" + randomToken(4).toUpperCase();

  if (!isConfigured()) {
    await db.payment.create({
      data: { tenantId: opts.tenantId, contactId: opts.contactId, reference, amount: opts.amountKes, currency: "KES", purpose: "topup", method: "mpesa", provider: "mock", status: "paid", paidAt: new Date() },
    });
    const updated = await db.contact.update({ where: { id: opts.contactId }, data: { credits: { increment: credits } } });
    return { ok: true, mock: true, credits, newBalance: updated.credits };
  }

  await db.payment.create({
    data: { tenantId: opts.tenantId, contactId: opts.contactId, reference, amount: opts.amountKes, currency: "KES", purpose: "topup", method: "mpesa", provider: "daraja", status: "pending" },
  });
  const res = await stkPush({ phone: opts.phone, amount: opts.amountKes, accountRef: reference, description: "P2Less credits" });
  if (!res.ok) {
    await db.payment.updateMany({ where: { reference }, data: { status: "failed" } });
    return { ok: false, error: res.error };
  }
  await db.payment.updateMany({ where: { reference }, data: { providerRef: res.checkoutId } });
  return { ok: true, mock: false, reference, customerMessage: res.customerMessage };
}
