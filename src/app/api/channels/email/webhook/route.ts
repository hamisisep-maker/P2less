import { handleInbound } from "@/lib/conversation";
import { db } from "@/lib/db";
import { verifyResendWebhookSignature, fetchReceivedEmail, extractPlainText } from "@/lib/email-channel";
import { recordInboundEvent, finishInboundEvent } from "@/lib/inbound-events";
import { runCrossTenant } from "@/lib/tenant-context";

// ─────────────────────────────────────────────────────────────────────────────
// Email channel adapter — Phase 8d, deliberately last/lowest-priority
// channel. Same shared engine as every other channel; the Resend-specific
// code is verifying the Svix-signed webhook and fetching the real body
// (webhooks carry metadata only — confirmed against Resend's own docs).
//
// ONE shared webhook (like WhatsApp/Messenger's app-level webhook, not
// Telegram's per-channel URL) — Resend's account-wide `email.received`
// event carries the real recipient address in `data.to[]`, which is what
// disambiguates tenants here, the same role phone_number_id/page_id play
// for WhatsApp/Messenger.
//
// v1 scope, stated not silent: text only, no attachment handling, quoted-
// reply stripping is a real but imperfect heuristic (see email-channel.ts).
// ─────────────────────────────────────────────────────────────────────────────

type ResendWebhookPayload = {
  type?: string;
  data?: { email_id?: string; from?: string; to?: string[]; subject?: string };
};

export async function POST(req: Request) {
  const raw = await req.text();

  const ok = verifyResendWebhookSignature(raw, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  });
  if (!ok) return new Response("Invalid signature", { status: 403 });

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(raw) as ResendWebhookPayload;
  } catch {
    return Response.json({ received: true }); // ack malformed to avoid retry storms
  }

  const startedAt = Date.now();
  const eventRecord = await recordInboundEvent({ source: "email_webhook", eventId: payload.data?.email_id, rawBody: raw });
  if (!eventRecord.duplicate) {
    void finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "processed", startedAt, responseStatus: 200 });
  }

  if (payload.type === "email.received" && !eventRecord.duplicate) {
    void processEmail(payload).catch((err) => console.error("[email-webhook] processEmail failed:", err));
  }
  return Response.json({ received: true });
}

async function processEmail(payload: ResendWebhookPayload): Promise<void> {
  const emailId = payload.data?.email_id;
  const recipients = payload.data?.to ?? [];
  const from = payload.data?.from;
  if (!emailId || !from || recipients.length === 0) {
    console.error("[email-webhook] missing emailId/from/recipients", { emailId, from, recipients });
    return;
  }

  // Deliberately cross-tenant — resolves WHICH tenant this recipient address
  // belongs to. Same category of gap as every other channel webhook's own
  // lookup, found in the same 2026-08-23 fail-closed audit.
  const channel = await runCrossTenant(() => db.channel.findFirst({ where: { type: "email", address: { in: recipients }, status: "active" } }));
  if (!channel) {
    console.error("[email-webhook] no active email channel for recipients", recipients);
    return; // sent to an address not connected to any tenant
  }

  const full = await fetchReceivedEmail(emailId);
  if (!full) {
    console.error("[email-webhook] fetchReceivedEmail returned null for", emailId);
    return;
  }
  const text = extractPlainText(full);
  if (!text) {
    console.error("[email-webhook] extractPlainText returned empty for", emailId);
    return; // nothing left after stripping the quoted thread
  }

  console.error("[email-webhook] calling handleInbound", { tenantId: channel.tenantId, from, textLength: text.length });
  await handleInbound({
    tenantId: channel.tenantId,
    fromNumber: from, // the sender's email address doubles as the "sender identity" InboundInput expects
    channelType: "email",
    text,
  });
  console.error("[email-webhook] handleInbound completed for", emailId);
}
