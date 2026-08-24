import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { meter } from "./usage";
import { decryptJSON } from "./crypto";
import { dispatchWebhook } from "./webhooks";
import { resolveMessengerToken } from "./messenger";
import { resolveTelegramToken, sendTelegramText } from "./telegram";
import { sendEmailReply } from "./email-channel";

// ─────────────────────────────────────────────────────────────────────────────
// Channel transport. The engine emits outbound messages through deliver(); each
// channel has its own delivery mechanism. WhatsApp is just one transport.
//
// WhatsApp delivery uses the official WhatsApp Business Cloud API (Graph API).
// Because the user messaged the business first, replies are free-form "session"
// messages inside the 24-hour customer-service window — no template required.
// ─────────────────────────────────────────────────────────────────────────────

export type OutboundMessage = {
  tenantId: string;
  conversationId: string;
  channelType: string;
  to: string; // recipient (the user's number)
  body: string;
  meta?: Record<string, unknown>;
  // The organization's Cloud-API phone_number_id to send FROM (routing identity).
  fromNumberId?: string | null;
  // Same routing role as fromNumberId, for Messenger — the org's connected
  // Facebook Page id.
  fromPageId?: string | null;
  // Same routing role again, for Telegram — the org's connected bot's own
  // numeric Telegram id (Channel.address), used to look up the bot token.
  fromTelegramBotId?: string | null;
  // When set, deliver this as a document (PDF) attachment, not just text.
  document?: { url: string; filename: string };
  // When set, deliver this as an image attachment (e.g. a product photo).
  image?: { url: string };
};

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

/** Resolve the access token for a given org number: per-number config wins, else
 *  the platform env token. Per-number tokens are encrypted at rest. */
async function resolveToken(fromNumberId?: string | null): Promise<string | null> {
  if (fromNumberId) {
    const num = await db.whatsAppNumber.findUnique({ where: { phoneNumberId: fromNumberId } });
    const cfg = decryptJSON<{ accessToken?: string }>((num?.webhookConfig as { enc?: string } | null)?.enc);
    if (cfg?.accessToken) return cfg.accessToken;
  }
  return process.env.WHATSAPP_ACCESS_TOKEN || null;
}

/** Show a WhatsApp "typing…" indicator (and mark the message read) while we work.
 *  Best-effort — needs the incoming message id + the org number's phone_number_id. */
export async function sendTyping(fromNumberId: string, messageId: string): Promise<void> {
  const token = await resolveToken(fromNumberId);
  if (!token) return;
  try {
    await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${fromNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }),
    });
  } catch {
    /* typing indicator is cosmetic; never block the reply on it */
  }
}

/** Download a WhatsApp media object (e.g. a voice note) → base64 + mime type.
 *  Two hops, both authenticated: media-id → a short-lived URL → the raw bytes. */
export async function fetchWhatsAppMedia(mediaId: string, fromNumberId?: string | null): Promise<{ base64: string; mimeType: string } | null> {
  const token = await resolveToken(fromNumberId);
  if (!token) return null;
  try {
    const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binRes.ok) return null;
    const buf = Buffer.from(await binRes.arrayBuffer());
    return { base64: buf.toString("base64"), mimeType: (meta.mime_type || "audio/ogg").split(";")[0] };
  } catch {
    return null;
  }
}

/** Download a Messenger attachment (image/audio/video/file) → base64 + mime
 *  type. One hop, unlike WhatsApp's two — Messenger's own `attachments[].
 *  payload.url` (confirmed against Meta's Send/webhook docs) is already a
 *  directly-fetchable, short-lived CDN link, no access token needed. Mime
 *  type is read from the real response header rather than trusted from the
 *  attachment's own `type` field (image/audio/video/file — not a real MIME
 *  type), same as WhatsApp's own fallback-by-content-type convention. */
export async function fetchMessengerAttachment(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0];
    return { base64: buf.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

/** Send a plain WhatsApp text directly (for system-level notes like "couldn't
 *  hear that voice note") without going through the metered conversation pipeline. */
export async function sendWhatsAppText(fromNumberId: string, to: string, body: string): Promise<void> {
  const token = await resolveToken(fromNumberId);
  if (!token) return;
  try {
    await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${fromNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body } }),
    });
  } catch {
    /* best effort */
  }
}

export async function deliver(msg: OutboundMessage): Promise<{ delivered: boolean; transport: string; error?: string }> {
  // Persist + meter the outbound message (the web simulator also reads it back).
  await db.message.create({
    data: {
      tenantId: msg.tenantId,
      conversationId: msg.conversationId,
      direction: "out",
      body: msg.body,
      meta: (msg.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  await meter(msg.tenantId, "message_out");
  void dispatchWebhook(msg.tenantId, "message.sent", { conversationId: msg.conversationId, to: msg.to, text: msg.body }).catch(() => {});

  switch (msg.channelType) {
    case "webchat":
    case "widget":
      // Returned to the caller by the API route; nothing to push server-side.
      return { delivered: true, transport: msg.channelType };

    case "whatsapp": {
      // Real functional gate: an admin disabling WhatsApp at /admin/integrations
      // genuinely stops outbound sends, not just a display badge.
      const integration = await db.integration.findUnique({ where: { key: "whatsapp_cloud_api" }, select: { enabled: true } });
      if (integration && !integration.enabled) {
        return { delivered: false, transport: "whatsapp:disabled", error: "WhatsApp integration is disabled by an administrator" };
      }
      const token = await resolveToken(msg.fromNumberId);
      if (!token || !msg.fromNumberId) {
        // Not configured yet (no Cloud API credentials): log so local dev still
        // shows the reply, and report honestly that it was not delivered.
        if (process.env.NODE_ENV !== "production") console.log(`[whatsapp:not-configured →${msg.to}] ${msg.body}`);
        return { delivered: false, transport: "whatsapp:not-configured", error: "WhatsApp credentials not configured" };
      }
      // A document/image attachment is sent as its own WhatsApp message type; the
      // media is fetched by WhatsApp from the public link (needs PUBLIC_BASE_URL).
      const payload = msg.image && /^https?:\/\//.test(msg.image.url)
        ? { messaging_product: "whatsapp", recipient_type: "individual", to: msg.to, type: "image", image: { link: msg.image.url, caption: msg.body } }
        : msg.document && /^https?:\/\//.test(msg.document.url)
        ? { messaging_product: "whatsapp", recipient_type: "individual", to: msg.to, type: "document", document: { link: msg.document.url, filename: msg.document.filename, caption: msg.body } }
        : { messaging_product: "whatsapp", recipient_type: "individual", to: msg.to, type: "text", text: { preview_url: true, body: msg.body } };
      try {
        const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${msg.fromNumberId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(`[whatsapp:send-failed ${res.status}] ${detail.slice(0, 300)}`);
          return { delivered: false, transport: "whatsapp", error: `Graph API ${res.status}` };
        }
        return { delivered: true, transport: "whatsapp" };
      } catch (e) {
        console.error("[whatsapp:send-error]", e);
        return { delivered: false, transport: "whatsapp", error: "network error" };
      }
    }

    case "messenger": {
      if (!msg.fromPageId) {
        return { delivered: false, transport: "messenger:not-configured", error: "No connected Facebook Page for this organization" };
      }
      const token = await resolveMessengerToken(msg.fromPageId);
      if (!token) {
        if (process.env.NODE_ENV !== "production") console.log(`[messenger:not-configured →${msg.to}] ${msg.body}`);
        return { delivered: false, transport: "messenger:not-configured", error: "Messenger Page token not configured" };
      }
      // Send API contract confirmed against Meta's own docs: POST
      // /{PAGE_ID}/messages?access_token=..., body {recipient,messaging_type,message}.
      // Unlike WhatsApp's combined image+caption message, Meta's own docs
      // don't demonstrate combining text and an attachment in one message
      // object — an attachment message carries `message.attachment`, not
      // `message.text`, so a caption goes out as its own preceding text
      // message (the same two-message shape a human sending "here's your
      // file" + the file would produce).
      const sendOne = async (body: Record<string, unknown>): Promise<{ ok: boolean; status?: number; detail?: string }> => {
        try {
          const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${msg.fromPageId}/messages?access_token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) return { ok: false, status: res.status, detail: (await res.text().catch(() => "")).slice(0, 300) };
          return { ok: true };
        } catch (e) {
          return { ok: false, detail: e instanceof Error ? e.message : "network error" };
        }
      };

      const attachmentPayload = msg.image
        ? { type: "image", payload: { url: msg.image.url, is_reusable: true } }
        : msg.document
        ? { type: "file", payload: { url: msg.document.url, is_reusable: true } }
        : null;

      if (attachmentPayload) {
        // Caption first (if any), THEN the file — mirrors sending order a
        // human would use, and means a caption-fetch/attachment-send
        // failure never hides the other half silently.
        if (msg.body.trim()) {
          const textResult = await sendOne({ recipient: { id: msg.to }, messaging_type: "RESPONSE", message: { text: msg.body } });
          if (!textResult.ok) console.error(`[messenger:send-failed ${textResult.status ?? ""}] ${textResult.detail}`);
        }
        const fileResult = await sendOne({ recipient: { id: msg.to }, messaging_type: "RESPONSE", message: { attachment: attachmentPayload } });
        if (!fileResult.ok) {
          console.error(`[messenger:send-failed ${fileResult.status ?? ""}] ${fileResult.detail}`);
          return { delivered: false, transport: "messenger", error: `Send API ${fileResult.status ?? fileResult.detail}` };
        }
        return { delivered: true, transport: "messenger" };
      }

      const result = await sendOne({ recipient: { id: msg.to }, messaging_type: "RESPONSE", message: { text: msg.body } });
      if (!result.ok) {
        console.error(`[messenger:send-failed ${result.status ?? ""}] ${result.detail}`);
        return { delivered: false, transport: "messenger", error: `Send API ${result.status ?? result.detail}` };
      }
      return { delivered: true, transport: "messenger" };
    }

    case "telegram": {
      if (!msg.fromTelegramBotId) {
        return { delivered: false, transport: "telegram:not-configured", error: "No connected Telegram bot for this organization" };
      }
      const token = await resolveTelegramToken(msg.fromTelegramBotId);
      if (!token) {
        if (process.env.NODE_ENV !== "production") console.log(`[telegram:not-configured →${msg.to}] ${msg.body}`);
        return { delivered: false, transport: "telegram:not-configured", error: "Telegram bot token not configured" };
      }
      const result = await sendTelegramText(token, msg.to, msg.body);
      if (!result.ok) {
        console.error(`[telegram:send-failed] ${result.error}`);
        return { delivered: false, transport: "telegram", error: result.error };
      }
      return { delivered: true, transport: "telegram" };
    }

    case "email": {
      // V1 scope, stated not silent: no real subject-line threading — the
      // original inbound subject isn't threaded through handleInbound()'s
      // shared InboundInput type, which every other channel also uses and
      // has no concept of "subject". A fixed reply subject rather than
      // touching that shared type for the lowest-priority channel.
      const result = await sendEmailReply(msg.to, "Reply from your assistant", msg.body);
      if (!result.ok) {
        console.error(`[email:send-failed] ${result.error}`);
        return { delivered: false, transport: "email", error: result.error };
      }
      return { delivered: true, transport: "email" };
    }

    case "sms":
      if (process.env.NODE_ENV !== "production") console.log(`[sms→${msg.to}] ${msg.body}`);
      return { delivered: true, transport: "sms:simulated" };

    default:
      return { delivered: false, transport: "unknown" };
  }
}
