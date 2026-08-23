import "server-only";
import { db } from "./db";
import { monthlyUsage } from "./usage";
import { randomToken } from "./crypto";
import { getSettingNumber, getAiProviderCosts } from "./platform-settings";

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
//
// PRICE/COST are runtime-configurable (PlatformSetting, editable at
// /admin/billing) with the historical hardcoded values as the fallback
// default — nothing changes for an existing deployment until an admin
// actually edits a value there.
// ─────────────────────────────────────────────────────────────────────────────

export type Pricing = { PRICE: { conversation: number; ai: number; document: number }; COST: { conversation: number; ai: number; document: number } };

export async function loadPricing(): Promise<Pricing> {
  const [priceConversation, priceAi, priceDocument, costConversation, costDocument, aiCosts] = await Promise.all([
    getSettingNumber("price_conversation_kes"),
    getSettingNumber("price_ai_kes"),
    getSettingNumber("price_document_kes"),
    getSettingNumber("cost_conversation_kes"),
    getSettingNumber("cost_document_kes"),
    getAiProviderCosts(),
  ]);
  // Blended AI cost-per-request: average of whatever providers the admin has
  // actually priced, so a tenant's estimated bill reflects real provider mix
  // rather than a single guessed number. Falls back to 0.4 (the old default)
  // if nothing has been configured yet.
  const configured = Object.values(aiCosts).filter((n) => n > 0);
  const costAi = configured.length ? configured.reduce((a, b) => a + b, 0) / configured.length : 0.4;
  return {
    PRICE: { conversation: priceConversation, ai: priceAi, document: priceDocument },
    COST: { conversation: costConversation, ai: costAi, document: costDocument },
  };
}

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
  //
  // Real gap found 2026-08-23, asked directly ("is WhatsApp the only channel
  // or are others considered"): "message_in" is metered inside
  // handleInbound(), the single entry point EVERY channel route calls
  // (WhatsApp, Messenger, Telegram, widget, webchat, email) — so `convos`
  // here is genuinely all-channel, not WhatsApp-only, despite the line
  // label below previously claiming otherwise. Relabeled to be accurate.
  // Deliberately NOT fixed in the same round: PRICE.conversation/
  // COST.conversation are a single flat rate applied to this same
  // all-channel count — meaning Messenger/Telegram/widget/email messages
  // are billed and cost-estimated at Meta's WhatsApp-specific rate, which
  // they don't actually incur. A real pricing-accuracy gap for any
  // multi-channel tenant, worth fixing, but a genuine per-channel pricing
  // design decision — not a label fix — so it's recorded, not rushed.
  const [convos, ai, docs, { PRICE, COST }] = await Promise.all([
    monthlyUsage(tenantId, "message_in"),
    monthlyUsage(tenantId, "ai_request"),
    monthlyUsage(tenantId, "document"),
    loadPricing(),
  ]);

  const lines: BillLine[] = [
    { label: "Conversations (all channels)", qty: convos, unit: PRICE.conversation, amount: convos * PRICE.conversation },
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

export type PlanLimits = { users?: number; messagesPerMonth?: number; connectors?: number; aiRequestsPerMonth?: number; documentsPerMonth?: number };

export type PlanMargin = {
  unlimited: boolean;
  revenueAtMax: number; // what a tenant on this plan pays P2Less if they max out every included limit
  costAtMax: number; // what P2Less pays Meta + AI providers for that same maxed-out usage
  marginAtMax: number;
  marginPct: number; // marginAtMax / revenueAtMax, as a percent — negative means this plan can LOSE money at full usage
  suggestedMinPrice: number; // planMonthlyFee that would make marginAtMax exactly 0 at these limits — i.e. break-even
};

/** For a given plan's included limits, compute what P2Less earns vs pays out
 *  if a tenant on that plan uses every bit of what they're allowed — the
 *  worst case that determines whether the plan is actually profitable, not
 *  just its headline price. Used by the /admin/billing margin calculator. */
export function computePlanMargin(planFee: number, limits: PlanLimits, pricing: Pricing): PlanMargin {
  const { PRICE, COST } = pricing;
  const hasLimits = limits.messagesPerMonth != null || limits.aiRequestsPerMonth != null || limits.documentsPerMonth != null;
  if (!hasLimits) {
    // Unlimited plan (e.g. Enterprise) — there's no "max usage" ceiling, so a
    // per-tenant margin can't be computed from limits alone; needs a real
    // negotiated/custom price instead of this calculator.
    return { unlimited: true, revenueAtMax: planFee, costAtMax: 0, marginAtMax: planFee, marginPct: planFee > 0 ? 100 : 0, suggestedMinPrice: planFee };
  }
  const convos = limits.messagesPerMonth ?? 0;
  const ai = limits.aiRequestsPerMonth ?? 0;
  const docs = limits.documentsPerMonth ?? 0;
  const revenueAtMax = planFee + convos * PRICE.conversation + ai * PRICE.ai + docs * PRICE.document;
  const costAtMax = convos * COST.conversation + ai * COST.ai + docs * COST.document;
  const marginAtMax = revenueAtMax - costAtMax;
  const marginPct = revenueAtMax > 0 ? (marginAtMax / revenueAtMax) * 100 : 0;
  // The lowest monthly fee that keeps this plan non-negative at full usage —
  // i.e. the metered lines alone don't cover the cost, so the flat fee must.
  const usageRevenue = convos * PRICE.conversation + ai * PRICE.ai + docs * PRICE.document;
  const suggestedMinPrice = Math.max(0, Math.ceil(costAtMax - usageRevenue));
  return { unlimited: false, revenueAtMax, costAtMax, marginAtMax, marginPct, suggestedMinPrice };
}

export type PlatformPnL = {
  revenueThisMonth: number; // real Payment rows, status=paid
  revenueAllTime: number;
  estimatedCostThisMonth: number; // Meta + document compute + AI, derived from real platform-wide usage
  estimatedAiSpendThisMonth: number; // real, from AiRequestLog token costs once any exist this month; falls back to calls × admin cost/call before that
  aiSpendIsReal: boolean; // true once AiRequestLog has real token-cost data for this month, false while still using the calls-based estimate
  estimatedProfitThisMonth: number;
};

/** Platform-wide (every tenant) revenue vs estimated cost for the current
 *  calendar month — the actual "are we making money" number, built from real
 *  Payment records (revenue) and real usage volumes (cost), not a guess.
 *  AI cost prefers the REAL per-request token ledger (AiRequestLog, see
 *  ai.ts) over the older calls × flat-cost-per-call estimate — the estimate
 *  is only a bridge for months before any real token data exists. */
export async function computePlatformPnL(): Promise<PlatformPnL> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthPrefix = now.toISOString().slice(0, 7); // "2026-08"

  const [revenueMonthAgg, revenueAllAgg, convos, docs, pricing, aiStatsThisMonth, aiRequestLogAgg] = await Promise.all([
    db.payment.aggregate({ where: { status: "paid", paidAt: { gte: startOfMonth } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { status: "paid" }, _sum: { amount: true } }),
    db.usageEvent.aggregate({ where: { type: "message_in", createdAt: { gte: startOfMonth } }, _sum: { quantity: true } }),
    db.usageEvent.aggregate({ where: { type: "document", createdAt: { gte: startOfMonth } }, _sum: { quantity: true } }),
    loadPricing(),
    db.aiProviderStat.findMany({ where: { date: { startsWith: monthPrefix } } }),
    db.aiRequestLog.aggregate({ where: { createdAt: { gte: startOfMonth } }, _sum: { costKes: true }, _count: { _all: true } }),
  ]);

  const realAiCostThisMonth = aiRequestLogAgg._sum.costKes ?? 0;
  const aiSpendIsReal = aiRequestLogAgg._count._all > 0;
  let estimatedAiSpendThisMonth = realAiCostThisMonth;
  if (!aiSpendIsReal) {
    // No real token-cost data logged yet this month (e.g. right after this
    // feature shipped) — fall back to the coarser calls × cost/call estimate
    // rather than showing 0.
    const aiCosts = await getAiProviderCosts();
    estimatedAiSpendThisMonth = aiStatsThisMonth.reduce((sum, s) => sum + s.successes * (aiCosts[s.provider] ?? 0), 0);
  }

  const convosCost = (convos._sum.quantity ?? 0) * pricing.COST.conversation;
  const docsCost = (docs._sum.quantity ?? 0) * pricing.COST.document;
  const estimatedCostThisMonth = Math.round(convosCost + docsCost + estimatedAiSpendThisMonth);
  const revenueThisMonth = revenueMonthAgg._sum.amount ?? 0;

  return {
    revenueThisMonth,
    revenueAllTime: revenueAllAgg._sum.amount ?? 0,
    estimatedCostThisMonth,
    estimatedAiSpendThisMonth: Math.round(estimatedAiSpendThisMonth),
    aiSpendIsReal,
    estimatedProfitThisMonth: revenueThisMonth - estimatedCostThisMonth,
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
