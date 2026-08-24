import crypto from "node:crypto";
import { handleInbound } from "@/lib/conversation";
import { db } from "@/lib/db";
import { recordInboundEvent, finishInboundEvent } from "@/lib/inbound-events";
import { runCrossTenant } from "@/lib/tenant-context";
import { fetchMessengerAttachment } from "@/lib/transport";

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
// v1 shipped text-only, stated not silent at the time. 2026-08-24 extends it
// to media attachments and postback buttons, closing that stated gap:
//   - message.attachments (image/audio/video/file) → downloaded via
//     fetchMessengerAttachment() (one hop — Messenger's own payload.url is
//     already a directly-fetchable CDN link, unlike WhatsApp's two-hop
//     authenticated flow) and passed through the SAME `attachment` field
//     handleInbound()'s super-app tool pipeline already understands — no
//     new conversation.ts logic needed, this is purely correct extraction.
//   - postback events (Get Started button, persistent-menu items, template
//     buttons) → treated as text-equivalent input through the same
//     pipeline. GET_STARTED specifically normalizes to "hi" (isGreeting()
//     already recognizes it, triggering the same numbered-menu reply a
//     typed greeting gets) since that's the near-universal real-world
//     convention for that button's payload; any other postback uses its
//     human-written button `title` (far more likely to intent-match than
//     the raw enum-like `payload` string), falling back to the payload only
//     if no title was sent.
// Still v1 scope, stated not silent: no typing indicator (no Messenger
// equivalent wired yet), no read receipts.
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
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        attachments?: { type?: string; payload?: { url?: string } }[];
      };
      postback?: { mid?: string; payload?: string; title?: string };
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
      if (!psid) continue;
      // is_echo: a message the PAGE itself sent (e.g. our own reply, or a
      // human agent's), delivered back through the same webhook — never
      // treat our own outbound message as new inbound input.
      if (m.message?.is_echo) continue;

      let text = "";
      let attachment: { base64: string; filename: string; mimeType: string } | undefined;

      if (m.postback) {
        if (!firstTimeSeeing(m.postback.mid)) continue; // skip Meta re-deliveries
        // GET_STARTED is the near-universal convention for the "Get Started"
        // button's payload — normalize to a real greeting so it triggers the
        // exact same numbered-menu reply a typed "hi" gets (isGreeting()
        // already recognizes "start"/"hi", no new conversation.ts branch
        // needed). Any other postback prefers the human-written button
        // title over the raw enum-like payload — far more likely to
        // intent-match sensibly.
        text = m.postback.payload === "GET_STARTED" ? "hi" : (m.postback.title || m.postback.payload || "hi");
      } else if (m.message) {
        if (!firstTimeSeeing(m.message.mid)) continue; // skip Meta re-deliveries
        text = m.message.text ?? "";

        // Media: image/audio/video/file. Only the first attachment is
        // handled — same "one file at a time" scope the WhatsApp webhook
        // and the super-app tool pipeline both already assume.
        const first = m.message.attachments?.[0];
        if (first?.payload?.url) {
          const dl = await fetchMessengerAttachment(first.payload.url);
          if (dl) {
            const ext = dl.mimeType.split("/")[1] || "bin";
            attachment = { base64: dl.base64, filename: `file.${ext}`, mimeType: dl.mimeType };
          }
        }
        if (!text.trim() && !attachment) continue; // nothing usable in this event
      } else {
        continue; // neither a message nor a postback — nothing to route
      }

      // Deliberately cross-tenant — resolves WHICH tenant this Page belongs
      // to. Same category of gap as the WhatsApp webhook's own lookup,
      // found in the same 2026-08-23 fail-closed audit.
      const channel = await runCrossTenant(() => db.channel.findFirst({ where: { type: "messenger", address: pageId, status: "active" } }));
      if (!channel) continue; // Page not connected to any tenant — nothing to route to

      await handleInbound({
        tenantId: channel.tenantId,
        fromNumber: psid, // PSID doubles as the "sender identity" InboundInput expects
        channelType: "messenger",
        text,
        attachment,
      });
    }
  }
}
