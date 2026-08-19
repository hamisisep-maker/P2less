import "server-only";
import { db } from "./db";
import { sha256 } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Real event-id-based idempotency for every inbound webhook/callback FROM a
// provider (M-Pesa STK/C2B, WhatsApp) — this is what "webhook monitoring"
// and "duplicate webhook is safely ignored" mean in practice. Distinct from
// the tenant-owned OUTBOUND `Webhook` model (P2Less -> a tenant's own
// systems) in webhooks.ts — different direction, not to be conflated.
//
// The unique constraint on idempotencyKey IS the dedup mechanism — a create()
// that throws a unique-constraint violation is the honest signal "we've seen
// this exact event before", not a bug to route around.
// ─────────────────────────────────────────────────────────────────────────────

export type RecordEventResult = { duplicate: true } | { duplicate: false; eventRecordId: string };

export async function recordInboundEvent(input: { source: string; eventId?: string | null; rawBody: string }): Promise<RecordEventResult> {
  const idempotencyKey = `${input.source}:${input.eventId ?? sha256(input.rawBody)}`;
  try {
    const row = await db.inboundEvent.create({
      data: { source: input.source, eventId: input.eventId ?? null, idempotencyKey, rawBody: input.rawBody.slice(0, 8000) },
    });
    return { duplicate: false, eventRecordId: row.id };
  } catch {
    // Unique constraint violation on idempotencyKey = a genuine duplicate
    // delivery. Bump retryCount on the original so it's visible how many
    // times this same event was re-delivered.
    await db.inboundEvent.update({ where: { idempotencyKey }, data: { retryCount: { increment: 1 } } }).catch(() => {});
    return { duplicate: true };
  }
}

export async function finishInboundEvent(eventRecordId: string, input: {
  processingStatus: "processed" | "failed" | "reconciliation_required";
  startedAt: number;
  responseStatus?: number;
  error?: string;
  relatedPaymentId?: string;
  relatedTenantId?: string;
}): Promise<void> {
  await db.inboundEvent.update({
    where: { id: eventRecordId },
    data: {
      processingStatus: input.processingStatus,
      processingMs: Date.now() - input.startedAt,
      responseStatus: input.responseStatus,
      error: input.error,
      relatedPaymentId: input.relatedPaymentId,
      relatedTenantId: input.relatedTenantId,
    },
  }).catch(() => {});
}
