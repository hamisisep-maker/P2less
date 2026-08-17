import "server-only";
import { db } from "./db";
import { monthlyUsage } from "./usage";
import { randomToken } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Billing / money flow.
//
// The organization pays P2Less: a monthly plan fee + metered usage. P2Less, in
// turn, settles the underlying costs it incurs on the org's behalf — chiefly the
// WhatsApp conversation charges Meta bills, plus AI/compute — and keeps a margin.
// So one bill to P2Less covers everything; P2Less pays Meta & providers itself.
//
// Amounts here are whole KES for demo clarity. Real deployments plug a gateway
// (Stripe / M-Pesa Daraja) into recordPayment() and reconcile Meta's invoice.
// ─────────────────────────────────────────────────────────────────────────────

// What P2Less charges the organization, per unit (KES).
const PRICE = { conversation: 2, ai: 1, document: 5 };
// What P2Less itself pays out, per unit (KES) — mostly Meta's WhatsApp fee.
const COST = { conversation: 1, ai: 0.4, document: 0.2 };

export type BillLine = { label: string; qty: number; unit: number; amount: number };

export type Bill = {
  currency: string;
  planName: string;
  planFee: number;
  lines: BillLine[];
  usageTotal: number;
  total: number; // what the org owes P2Less
  passthrough: number; // what P2Less will pay Meta + providers
  margin: number; // P2Less gross margin
  periodLabel: string;
};

export async function computeBill(tenantId: string): Promise<Bill> {
  const sub = await db.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  const planFee = sub?.plan.priceMonthly ?? 0;
  const planName = sub?.plan.name ?? "No plan";

  // Conversations ≈ inbound messages (WhatsApp bills per 24h conversation window;
  // we approximate here). AI + documents are metered directly.
  const [convos, ai, docs] = await Promise.all([
    monthlyUsage(tenantId, "message_in"),
    monthlyUsage(tenantId, "ai_request"),
    monthlyUsage(tenantId, "document"),
  ]);

  const lines: BillLine[] = [
    { label: "WhatsApp conversations", qty: convos, unit: PRICE.conversation, amount: convos * PRICE.conversation },
    { label: "AI understanding requests", qty: ai, unit: PRICE.ai, amount: ai * PRICE.ai },
    { label: "Documents generated (PDF)", qty: docs, unit: PRICE.document, amount: docs * PRICE.document },
  ];
  const usageTotal = lines.reduce((s, l) => s + l.amount, 0);
  const total = planFee + usageTotal;
  const passthrough = Math.round(convos * COST.conversation + ai * COST.ai + docs * COST.document);
  const margin = total - passthrough;

  return {
    currency: "KES",
    planName,
    planFee,
    lines,
    usageTotal,
    total,
    passthrough,
    margin,
    periodLabel: new Date().toISOString().slice(0, 7),
  };
}

/** Record a payment from the org to P2Less. A real gateway call goes here; for
 *  the MVP we mark it paid immediately (clearly a mock). */
export async function recordPayment(opts: {
  tenantId: string; amount: number; currency?: string; purpose?: string; method?: string; periodLabel?: string;
}) {
  const reference = "PAY-" + randomToken(4).toUpperCase();
  return db.payment.create({
    data: {
      tenantId: opts.tenantId,
      reference,
      amount: opts.amount,
      currency: opts.currency ?? "KES",
      purpose: opts.purpose ?? "subscription",
      method: opts.method ?? "mpesa",
      status: "paid", // mock gateway success — replace with real webhook confirmation
      provider: "manual",
      periodLabel: opts.periodLabel ?? new Date().toISOString().slice(0, 7),
      paidAt: new Date(),
    },
  });
}
