import "server-only";
import { db } from "./db";
import { stkPush, isConfigured } from "./mpesa";

// ─────────────────────────────────────────────────────────────────────────────
// Business catalog — conversational browsing + ordering of a tenant's own
// products. Native to P2Less (not a connector to an external system), so any
// tenant can self-serve a catalog from the dashboard regardless of industry.
//
// NOTE: this reuses the platform's own (currently sandbox) M-Pesa credentials —
// same as wallet top-ups — so payment really flows through Daraja end to end.
// For production, each business would configure its OWN Till/Paybill so sales
// settle directly to them rather than through P2Less's shared shortcode; that's
// a natural next step (per-tenant payment config), not yet built.
// ─────────────────────────────────────────────────────────────────────────────

export type CatalogProduct = { id: string; name: string; description: string | null; price: number; currency: string; category: string | null; inStock: boolean };

/** Does this message look like someone asking what's for sale? */
export function isCatalogBrowseRequest(lower: string): boolean {
  return /\b(what).{0,15}\b(sell|have|offer|sale|stock)\b|\b(do you (sell|have|stock|offer))\b|\b(show|see|list).{0,10}\b(product|item|menu|catalog|stock)\b|\bprice list\b|\bwhat'?s (on|for) (offer|sale)\b/i.test(lower);
}

/** Does this message look like a request to buy something? Catches an explicit
 *  buy-verb ("I want to buy X") AND our own suggested reply shape from the
 *  catalog listing itself ("2 of the navy sweater" has no verb at all). */
export function isOrderRequest(lower: string): boolean {
  if (/\b(cv|resume|résumé)\b/i.test(lower)) return false;
  if (/\b(buy|order|purchase|want|need)\b/i.test(lower)) return true;
  return /^\s*\d+\s*(x|×)?\s*\S/.test(lower) || /\bof the\b/i.test(lower);
}

export function formatCatalog(assistant: string, products: CatalogProduct[]): string {
  const available = products.filter((p) => p.inStock);
  if (available.length === 0) return `We don't have anything listed right now — check back soon, or contact ${assistant} directly.`;
  const byCategory = new Map<string, CatalogProduct[]>();
  for (const p of available) {
    const cat = p.category || "Products";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(p);
  }
  const parts: string[] = [];
  for (const [cat, items] of byCategory) {
    const lines = items.map((p) => `• ${p.name} — ${p.currency} ${p.price.toLocaleString("en-US")}${p.description ? ` (${p.description})` : ""}`);
    parts.push(byCategory.size > 1 ? `*${cat}*\n${lines.join("\n")}` : lines.join("\n"));
  }
  return `Here's what we have:\n\n${parts.join("\n\n")}\n\nJust tell me what you'd like and how many, e.g. "2 of the navy sweater".`;
}

/** Find the best-matching product(s) for free text. Scores by the PROPORTION of
 *  a product's significant words found in the query — not just "any word
 *  matched" — so a generic shared word (e.g. every uniform item starting with
 *  "School") doesn't make unrelated products tie for a match. Returns an exact
 *  single match, a disambiguation list (genuine ties), or none. */
export function matchProduct(query: string, products: CatalogProduct[]): { hit?: CatalogProduct; candidates?: CatalogProduct[] } {
  const q = query.toLowerCase();
  const available = products.filter((p) => p.inStock);

  const exact = available.filter((p) => q.includes(p.name.toLowerCase()));
  if (exact.length === 1) return { hit: exact[0] };
  if (exact.length > 1) return { candidates: exact };

  const scored = available
    .map((p) => {
      const words = p.name.toLowerCase().split(/[\s—–-]+/).filter((w) => w.length > 3);
      const matched = words.filter((w) => q.includes(w));
      return { product: p, score: words.length ? matched.length / words.length : 0, matched: matched.length };
    })
    .filter((s) => s.matched > 0);

  if (scored.length === 0) return {};
  scored.sort((a, b) => b.score - a.score || b.matched - a.matched);
  const top = scored.filter((s) => s.score === scored[0].score);
  if (top.length === 1) return { hit: top[0].product };
  return { candidates: top.map((s) => s.product) };
}

/** Pull a quantity from free text ("2 of the sweater", "three sweaters"); default 1. */
export function extractQuantity(text: string): number {
  const digit = text.match(/\b(\d+)\b/);
  if (digit) return Math.max(1, parseInt(digit[1], 10));
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  for (const [w, n] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`, "i").test(text)) return n;
  return 1;
}

export type OrderPaymentResult =
  | { ok: true; mock: true }
  | { ok: true; mock: false; customerMessage: string }
  | { ok: false; error: string };

/** Real M-Pesa STK push for an ORDER (not the credit wallet). On success the
 *  customer's phone shows the PIN prompt; final confirmation arrives async at
 *  the Daraja callback, which marks the Order paid. Falls back to an instant
 *  mock (and marks the order paid immediately) when M-Pesa isn't configured. */
export async function startOrderPayment(opts: { tenantId: string; orderId: string; phone: string; amountKes: number; reference: string }): Promise<OrderPaymentResult> {
  if (!isConfigured()) {
    await db.payment.create({ data: { tenantId: opts.tenantId, orderId: opts.orderId, reference: opts.reference, amount: opts.amountKes, currency: "KES", purpose: "order", method: "mpesa", provider: "mock", status: "paid", paidAt: new Date() } });
    await db.order.update({ where: { id: opts.orderId }, data: { status: "paid", paidAt: new Date() } });
    return { ok: true, mock: true };
  }
  await db.payment.create({ data: { tenantId: opts.tenantId, orderId: opts.orderId, reference: opts.reference, amount: opts.amountKes, currency: "KES", purpose: "order", method: "mpesa", provider: "daraja", status: "pending" } });
  const res = await stkPush({ phone: opts.phone, amount: opts.amountKes, accountRef: opts.reference, description: "Order payment" });
  if (!res.ok) {
    await db.payment.updateMany({ where: { reference: opts.reference }, data: { status: "failed" } });
    return { ok: false, error: res.error };
  }
  await db.payment.updateMany({ where: { reference: opts.reference }, data: { providerRef: res.checkoutId } });
  return { ok: true, mock: false, customerMessage: res.customerMessage };
}
