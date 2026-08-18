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

export type CatalogProduct = { id: string; name: string; description: string | null; price: number; currency: string; category: string | null; inStock: boolean; imageUrl?: string | null; options?: string | null; stockQuantity?: number | null };

/** Is this product actually orderable right now? Respects BOTH the manual
 *  inStock toggle AND tracked quantity (when set) hitting zero — a product
 *  isn't "in stock" just because someone forgot to flip the toggle after
 *  selling the last one. */
export function isAvailable(p: CatalogProduct): boolean {
  return p.inStock && (p.stockQuantity == null || p.stockQuantity > 0);
}

/** Does this message look like someone asking what's for sale? Excludes "do you
 *  have X" when X is a specific different topic (an image, a warranty, delivery,
 *  etc.) — that's a real question deserving its own honest answer, not a catalog
 *  dump ("do you have an image of the product" is NOT "what do you sell"). */
export function isCatalogBrowseRequest(lower: string): boolean {
  const genericHave = /\b(do you (sell|have|stock|offer))\b(?!.{0,20}\b(image|images|photo|photos|picture|pictures|pic|pics|video|discount|warranty|return|refund|delivery|shipping|receipt|invoice|colou?r|size)\b)/i;
  return /\b(what).{0,15}\b(sell|have|offer|sale|stock)\b/i.test(lower) || genericHave.test(lower) || /\b(show|see|list).{0,10}\b(product|item|menu|catalog|stock)\b/i.test(lower) || /\bprice list\b/i.test(lower) || /\bwhat'?s (on|for) (offer|sale)\b/i.test(lower);
}

/** Asking about PRODUCT PHOTOS — needs its own handling (find the specific
 *  product and send its real photo, or answer honestly if it has none), not a
 *  "couldn't match" dump from tripping the order-matching path (e.g. "i need
 *  images of those catalog" contains "need", which would otherwise read as buy
 *  intent). */
export function isProductImageRequest(lower: string): boolean {
  return /\b(image|images|photo|photos|picture|pictures|pic|pics)\b/i.test(lower);
}

/** A question ABOUT a product (price, size, color, material, description) that
 *  should stay in the commerce domain and be answered from real catalog data —
 *  never leak into an unrelated connector action (a real bug: "tell me about
 *  the price and size" once got answered with a school fee balance because
 *  nothing caught it before it reached general intent-routing). Excludes
 *  messages that are clearly about something else even if they share a word
 *  ("how much are the fees" contains "how much" but is not a product question). */
export function isProductAttributeQuestion(lower: string): boolean {
  const domainExclusions = /\b(fee|fees|balance|attendance|exam|results?|appointment|leave|payslip|salary|admission|grade|arrived|meeting)\b/i;
  if (domainExclusions.test(lower)) return false;
  return /\b(price|prize|cost|how much|size|sizes|colou?r|colours?|material|spec|specs|specification|detail|details|description)\b/i.test(lower);
}

/** Delivery vs pickup — asked once per order so we never silently assume.
 *  NOTE: \b after "deliver" alone does NOT match "delivered"/"delivering" (the
 *  next character is still a word character) — a real bug that made "delivered"
 *  fail to register as an answer. Match the stem without a trailing boundary. */
export function isDeliveryIntent(lower: string): boolean {
  return /\bdeliver|\bdrop(ped|ping)? off|bring it|send it (to|over)|\bcourier/i.test(lower);
}
export function isPickupIntent(lower: string): boolean {
  return /\bpick(ed|ing)? ?up|\bcollect(ed|ing)?\b|\bmyself\b|in person|come to the shop|i'?ll come|i will come|at the shop|self ?collect/i.test(lower);
}

/** Is this address detailed enough to actually find the place, or too vague to
 *  hand to a driver ("nairobi" alone isn't enough — ask for more, same reasoning
 *  as never assuming an unspecified quantity). */
export function isAddressDetailed(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length >= 3;
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
  const available = products.filter(isAvailable);
  if (available.length === 0) return `We don't have anything listed right now — check back soon, or contact ${assistant} directly.`;
  const byCategory = new Map<string, CatalogProduct[]>();
  for (const p of available) {
    const cat = p.category || "Products";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(p);
  }
  const parts: string[] = [];
  let anyPhotos = false;
  for (const [cat, items] of byCategory) {
    const lines = items.map((p) => {
      if (p.imageUrl) anyPhotos = true;
      // Only mention remaining stock once it's genuinely low (≤5) — otherwise
      // "47 left" is just noise; the honest signal is scarcity, not the count.
      const lowStock = p.stockQuantity != null && p.stockQuantity <= 5 ? ` (only ${p.stockQuantity} left!)` : "";
      return `• ${p.name} — ${p.currency} ${p.price.toLocaleString("en-US")}${p.description ? ` (${p.description})` : ""}${p.options ? ` [${p.options}]` : ""}${p.imageUrl ? " 📷" : ""}${lowStock}`;
    });
    parts.push(byCategory.size > 1 ? `*${cat}*\n${lines.join("\n")}` : lines.join("\n"));
  }
  const photoHint = anyPhotos ? ` (📷 = photo available, just ask e.g. "photo of the navy sweater")` : "";
  return `Here's what we have${photoHint}:\n\n${parts.join("\n\n")}\n\nJust tell me what you'd like and how many, e.g. "2 of the navy sweater".`;
}

/** Find the best-matching product(s) for free text. Scores by the PROPORTION of
 *  a product's significant words found in the query — not just "any word
 *  matched" — so a generic shared word (e.g. every uniform item starting with
 *  "School") doesn't make unrelated products tie for a match. Returns an exact
 *  single match, a disambiguation list (genuine ties), or none. */
export function matchProduct(query: string, products: CatalogProduct[]): { hit?: CatalogProduct; candidates?: CatalogProduct[] } {
  const q = query.toLowerCase();
  const available = products.filter(isAvailable);

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

/** Bare, low-noise product-name mention with NO buy verb ("mitumba") — only an
 *  EXACT product-name substring match, never the fuzzy/scored path, so a short
 *  unrelated message that merely shares a word with a product name (e.g. "how
 *  is school going") can't misfire into starting an order. Used so a plain
 *  product name reliably starts the REAL order flow instead of falling through
 *  to free-form AI chat that has no backing state (asks "how many would you
 *  like?" then has nowhere to put the answer). */
export function findExactProductMention(text: string, products: CatalogProduct[]): CatalogProduct | null {
  const q = text.toLowerCase();
  const hits = products.filter((p) => isAvailable(p) && q.includes(p.name.toLowerCase()));
  return hits.length === 1 ? hits[0] : null;
}

export type StockReserveResult = { ok: true } | { ok: false; available: number };

/** Atomically decrements tracked stock at the moment a sale is genuinely paid
 *  for. Returns ok:false with the REAL remaining count if there wasn't enough
 *  — this can legitimately happen if two customers buy the last units around
 *  the same time; never oversell silently. No-ops (always ok) for a product
 *  that doesn't track quantity (stockQuantity is null). */
export async function reserveStock(productId: string, qty: number): Promise<StockReserveResult> {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product || product.stockQuantity == null) return { ok: true };
  const updated = await db.product.updateMany({ where: { id: productId, stockQuantity: { gte: qty } }, data: { stockQuantity: { decrement: qty } } });
  if (updated.count > 0) return { ok: true };
  const fresh = await db.product.findUnique({ where: { id: productId } });
  return { ok: false, available: fresh?.stockQuantity ?? 0 };
}

/** Was a quantity actually said, or would extractQuantity() just be silently
 *  defaulting to 1? Lets the order flow ASK how many instead of assuming —
 *  the person should never have to notice afterwards that we guessed. */
export function hasExplicitQuantity(text: string): boolean {
  if (/\b\d+\b/.test(text)) return true;
  const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const lower = text.toLowerCase();
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
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
