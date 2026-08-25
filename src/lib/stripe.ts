import "server-only";
import Stripe from "stripe";

// ─────────────────────────────────────────────────────────────────────────────
// Stripe — card-on-file for /onboard signup (trial-abuse deterrent). A
// SetupIntent verifies a real, chargeable card exists WITHOUT charging it —
// no PaymentIntent, no charge, zero money moves, ever. If unconfigured, the
// card step is skipped entirely rather than blocking signup — same
// "always works, degrades gracefully" philosophy as every other optional
// provider in this codebase (AI, SMS, WhatsApp).
// ─────────────────────────────────────────────────────────────────────────────

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return client;
}

export function isConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PUBLISHABLE_KEY;
}

export function publishableKey(): string {
  return process.env.STRIPE_PUBLISHABLE_KEY || "";
}

/** Starts a $0 card verification. Returns the client_secret the browser needs
 *  to collect card details and confirm via Stripe.js — raw card numbers
 *  never touch our server (PCI scope stays with Stripe).
 *
 *  payment_method_types is deliberately explicit ("card" only) rather than
 *  left to the account's automatic_payment_methods default — found live
 *  while testing that this Stripe account's default set includes several
 *  redirect-based methods (Klarna, Cashapp, Bancontact, etc.), which Stripe
 *  refuses to set up without a return_url. The UI here only ever collects a
 *  card (CardElement), so restricting to that avoids the redirect
 *  requirement entirely instead of pretending to support methods with no
 *  actual UI for them. */
export async function createSetupIntent(): Promise<{ clientSecret: string; setupIntentId: string } | { error: string }> {
  try {
    const si = await stripe().setupIntents.create({ usage: "off_session", payment_method_types: ["card"] });
    if (!si.client_secret) return { error: "Could not start card verification. Please try again." };
    return { clientSecret: si.client_secret, setupIntentId: si.id };
  } catch (e) {
    console.error("[stripe] createSetupIntent failed:", e instanceof Error ? e.message : e);
    return { error: "Could not start card verification. Please try again." };
  }
}

/** Server-side re-check before trusting a client-reported "card verified" —
 *  never take the browser's word alone that confirmCardSetup succeeded. On
 *  failure, also returns the SAME client_secret so the caller can offer a
 *  retry (e.g. a declined card) without minting a fresh SetupIntent. */
export async function verifySetupIntentSucceeded(
  setupIntentId: string,
): Promise<{ ok: true; paymentMethodId: string } | { ok: false; error: string; clientSecret: string }> {
  try {
    const si = await stripe().setupIntents.retrieve(setupIntentId);
    if (si.status !== "succeeded") {
      return { ok: false, error: "Card verification wasn't completed. Please try again.", clientSecret: si.client_secret ?? "" };
    }
    const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
    if (!pm) return { ok: false, error: "Card verification succeeded but no card was attached. Please try again.", clientSecret: si.client_secret ?? "" };
    return { ok: true, paymentMethodId: pm };
  } catch (e) {
    console.error("[stripe] verifySetupIntentSucceeded failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not confirm card verification. Please try again.", clientSecret: "" };
  }
}

/** Creates the real Stripe Customer for this new tenant and attaches the
 *  already-verified card as its default payment method — ready for real
 *  billing later without asking the org to re-enter their card. */
export async function createCustomerWithCard(email: string, name: string, paymentMethodId: string): Promise<{ customerId: string } | { error: string }> {
  try {
    const customer = await stripe().customers.create({
      email, name, payment_method: paymentMethodId,
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    return { customerId: customer.id };
  } catch (e) {
    console.error("[stripe] createCustomerWithCard failed:", e instanceof Error ? e.message : e);
    return { error: "Could not save your card on file. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice-centric paid-upgrade flow, 2026-08-25 — real card charging, built
// on Stripe's hosted Checkout (not Elements/PaymentIntent-direct — zero
// custom card-form code needed, PCI scope stays entirely with Stripe). This
// is a real charge, unlike createSetupIntent() above ($0, never charged).
//
// KES is a real two-decimal currency in Stripe (confirmed live against the
// actual test-mode API before this was written — Kenyan Shilling doesn't
// appear on Stripe's zero-decimal or special-case currency lists, matching
// ISO 4217's minor-unit-2 designation) — amounts are sent in CENTS
// (Math.round(payableKes * 100)), not whole KES the way Daraja's stkPush()
// takes whole shillings. Getting this backwards would be a real 100x over/
// undercharge.
// ─────────────────────────────────────────────────────────────────────────────

export async function createCheckoutSession(opts: {
  invoiceId: string; invoiceNumber: string; payableKes: number; successUrl: string; cancelUrl: string;
}): Promise<{ url: string; sessionId: string } | { error: string }> {
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "kes",
          product_data: { name: `P2Less upgrade — ${opts.invoiceNumber}` },
          unit_amount: Math.round(opts.payableKes * 100),
        },
        quantity: 1,
      }],
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      // Both set on purpose — client_reference_id is Stripe's own
      // purpose-built field for exactly this ("what internal record does
      // this checkout belong to"); metadata.invoiceId is a second,
      // independent read of the same value on the webhook side, belt and
      // suspenders on the one field the webhook trusts to identify the
      // invoice.
      client_reference_id: opts.invoiceId,
      metadata: { invoiceId: opts.invoiceId },
    });
    if (!session.url) return { error: "Could not start card payment. Please try again." };
    return { url: session.url, sessionId: session.id };
  } catch (e) {
    console.error("[stripe] createCheckoutSession failed:", e instanceof Error ? e.message : e);
    return { error: "Could not start card payment. Please try again." };
  }
}

/** Re-fetches a Checkout Session's URL — used only for the "a payment for
 *  this invoice is already in flight" retry path (initiateInvoiceCardPaymentAction,
 *  invoicing.ts), so the user can be handed a valid link back to the SAME
 *  session rather than the route minting a duplicate one. Returns null if
 *  the session can't be found or has expired (Checkout Sessions expire
 *  after 24h) — the caller treats that as "start over". */
export async function retrieveCheckoutSessionUrl(sessionId: string): Promise<string | null> {
  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    return session.url;
  } catch (e) {
    console.error("[stripe] retrieveCheckoutSessionUrl failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Verifies the Stripe-Signature header over the RAW request body — never
 *  trust an unsigned/incorrectly-signed webhook delivery. Returns null on
 *  any verification failure (missing secret, missing/invalid signature,
 *  tampered body) rather than throwing, mirroring this file's existing
 *  `{ error }` convention; the caller (the webhook route) is responsible for
 *  responding 400, not 200 — unlike Safaricom's callbacks, a bad signature
 *  here is a real attack surface, not a delivery quirk to swallow. */
export function constructWebhookEvent(rawBody: string, signatureHeader: string | null): Stripe.Event | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return null;
  try {
    return stripe().webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch (e) {
    console.error("[stripe] webhook signature verification failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
