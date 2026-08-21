import crypto from "node:crypto";
import { handleInbound } from "@/lib/conversation";
import { db } from "@/lib/db";
import { recordInboundEvent, finishInboundEvent } from "@/lib/inbound-events";

// ─────────────────────────────────────────────────────────────────────────────
// Facebook Messenger channel adapter — Phase 8a. Same shared engine as
// WhatsApp/webchat/widget; the only Messenger-specific code is parsing the
// provider payload (confirmed against Meta's own Messenger webhook docs
// before writing this) and routing to the same handleInbound(), the way
// every other channel already works.
//
// GET  = Meta webhook verification handshake (same shape as WhatsApp's).
// POST = inbound message events, routed Page ID → tenant via the Channel
//        row saveConnectedPage() creates (messenger.ts).
//
// v1 scope, stated not silent: text messages only. No media download (no
// Messenger equivalent of fetchWhatsAppMedia() yet), no typing indicator,
// no postback-button handling — a real, bounded first slice matching how
// little of Messenger's surface Mode 1 (customer asks, gets a grounded
// answer) actually needs to start.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = process.env.MESSENGER_VERIFY_TOKEN || "p2less-verify";
  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type MessengerPayload = {
  entry?: {
    id?: string;
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      message?: { mid?: string; text?: string; is_echo?: boolean };
    }[];
  }[];
};

export async function POST(req: Request) {
  const raw = await req.text();

  // Same signature scheme as the WhatsApp webhook — same App Secret, since
  // this is the SAME Meta App (confirmed live 2026-08-21).
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const sig = req.headers.get("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
    const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return new Response("Invalid signature", { status: 403 });
  }

  let payload: MessengerPayload;
  try {
    payload = JSON.parse(raw) as MessengerPayload;
  } catch {
    return Response.json({ received: true }); // ack malformed to avoid retry storms
  }

  const startedAt = Date.now();
  const eventRecord = await recordInboundEvent({ source: "messenger_webhook", rawBody: raw });
  if (!eventRecord.duplicate) {
    void finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "processed", startedAt, responseStatus: 200 });
  }

  // Ack immediately, process in the background — same reasoning as the
  // WhatsApp webhook: making Meta wait on our AI call risks a re-delivery
  // that would otherwise double-reply.
  void processEvents(payload).catch(() => {});
  return Response.json({ received: true });
}

const handledIds = new Set<string>();
function firstTimeSeeing(id: string | undefined): boolean {
  if (!id) return true;
  if (handledIds.has(id)) return false;
  handledIds.add(id);
  if (handledIds.size > 1000) handledIds.delete(handledIds.values().next().value as string);
  return true;
}

async function processEvents(payload: MessengerPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    const pageId = entry.id;
    if (!pageId) continue;
    for (const m of entry.messaging ?? []) {
      const psid = m.sender?.id;
      const text = m.message?.text;
      // is_echo: a message the PAGE itself sent (e.g. our own reply, or a
      // human agent's), delivered back through the same webhook — never
      // treat our own outbound message as new inbound input.
      if (!psid || !text || m.message?.is_echo) continue;
      if (!firstTimeSeeing(m.message?.mid)) continue; // skip Meta re-deliveries

      const channel = await db.channel.findFirst({ where: { type: "messenger", address: pageId, status: "active" } });
      if (!channel) continue; // Page not connected to any tenant — nothing to route to

      await handleInbound({
        tenantId: channel.tenantId,
        fromNumber: psid, // PSID doubles as the "sender identity" InboundInput expects
        channelType: "messenger",
        text,
      });
    }
  }
}
