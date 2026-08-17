import "server-only";
import { db } from "./db";
import { hmacSign, randomToken } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Outbound webhooks. When a tenant event occurs (message received/sent, payment
// paid…), we POST a signed JSON payload to each subscribed URL. Deliveries are
// best-effort and fire-and-forget here; a production system moves this to a queue
// with retries + a delivery log. Each request carries an HMAC signature the
// receiver verifies with their webhook secret.
// ─────────────────────────────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  "message.received",
  "message.sent",
  "conversation.escalated",
  "payment.paid",
  "document.generated",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Deliver an event to every active webhook of a tenant subscribed to it. */
export async function dispatchWebhook(tenantId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  let hooks;
  try {
    hooks = await db.webhook.findMany({ where: { tenantId, active: true } });
  } catch {
    return;
  }
  const targets = hooks.filter((h) => {
    const events = (h.events as string[]) ?? [];
    return events.includes(event) || events.includes("*");
  });
  if (targets.length === 0) return;

  const body = JSON.stringify({
    id: "evt_" + randomToken(8),
    type: event,
    created: new Date().toISOString(),
    tenantId,
    data,
  });

  await Promise.all(
    targets.map(async (h) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        await fetch(h.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-P2Less-Event": event,
            "X-P2Less-Signature": "sha256=" + hmacSign(h.secret, body),
          },
          body,
          signal: controller.signal,
        });
      } catch {
        // Delivery is best-effort; production retries via a queue.
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
