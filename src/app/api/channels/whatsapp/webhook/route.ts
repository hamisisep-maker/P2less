import crypto from "node:crypto";
import { handleInbound } from "@/lib/conversation";
import { sendTyping, fetchWhatsAppMedia, sendWhatsAppText } from "@/lib/transport";
import { transcribeAudio } from "@/lib/ai";
import { db } from "@/lib/db";
import { recordInboundEvent, finishInboundEvent } from "@/lib/inbound-events";
import { runCrossTenant } from "@/lib/tenant-context";

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Cloud API channel adapter. Same shared engine as web chat — the only
// WhatsApp-specific code is parsing the provider payload and (in production)
// sending replies back via the Graph API in transport.ts.
//
// GET  = Meta webhook verification handshake.
// POST = inbound message events. We map the sender's number → tenant via the
//        Channel that owns the business phone number id.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "p2less-verify";
  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type WaPayload = {
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: {
          id?: string; from?: string; type?: string;
          text?: { body?: string };
          audio?: { id?: string; mime_type?: string; voice?: boolean };
          document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
        }[];
        // account_update's shape varies by event subtype (Meta docs cover
        // AD_ACCOUNT_LINKED explicitly; the "a Tech Provider's client finished
        // Embedded Signup" event is not confirmed here — see the honest
        // log-first handling in processAccountUpdate() below).
        event?: string;
        [key: string]: unknown;
      };
    }[];
  }[];
};

export async function POST(req: Request) {
  // Read the RAW body so we can verify Meta's signature over the exact bytes.
  const raw = await req.text();

  // Verify X-Hub-Signature-256 (HMAC-SHA256 of the body with the app secret).
  // If an app secret is configured, an invalid/absent signature is rejected.
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const sig = req.headers.get("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
    const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return new Response("Invalid signature", { status: 403 });
  }

  let payload: WaPayload;
  try {
    payload = JSON.parse(raw) as WaPayload;
  } catch {
    return Response.json({ received: true }); // ack malformed to avoid retry storms
  }

  // Real health signal, independent of message-processing success: this is
  // the "is the webhook actually receiving events" fact system-health needs —
  // decoupled from the in-memory wamid dedupe below (which guards against a
  // double REPLY, not against double-counting the webhook hit itself).
  const startedAt = Date.now();
  const eventRecord = await recordInboundEvent({ source: "whatsapp_webhook", rawBody: raw });
  if (!eventRecord.duplicate) {
    void finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "processed", startedAt, responseStatus: 200 });
  }

  // Process WITHOUT blocking the 200 ack. Our pipeline makes AI calls that can
  // take a few seconds; if we make Meta wait, it assumes failure and RE-DELIVERS
  // the same message, which gets handled twice (the duplicate replies the user
  // saw). Ack immediately, do the work in the background, and guard against any
  // retry that already slipped through with a message-id dedupe.
  void processEvents(payload).catch(() => {});
  return Response.json({ received: true });
}

// Message ids (wamids) we've already handled — a retry guard so a re-delivered
// webhook never produces a second reply. In-memory + size-capped (fine for a
// single long-running server; swap for a shared store if horizontally scaled).
const handledIds = new Set<string>();
function firstTimeSeeing(id: string | undefined): boolean {
  if (!id) return true; // no id → can't dedupe; process it
  if (handledIds.has(id)) return false;
  handledIds.add(id);
  if (handledIds.size > 1000) handledIds.delete(handledIds.values().next().value as string);
  return true;
}

async function processEvents(payload: WaPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;

      // Phase 9 (Embedded Signup): the ONLY channel left to learn a newly
      // connected client's wabaId/phoneNumberId for the hosted-redirect signup
      // variant (see the callback route's comment). Genuinely unverified which
      // `event` value/shape Meta sends for "Tech Provider client finished
      // onboarding" — logging the full raw payload every time until a real one
      // is observed, rather than guessing a shape and silently dropping events
      // that don't match it.
      if (change.field === "account_update") {
        console.log("[whatsapp:account_update]", JSON.stringify({ entryId: entry.id, value }));
        continue;
      }

      const phoneNumberId = value?.metadata?.phone_number_id;
      const messages = value?.messages ?? [];
      if (!phoneNumberId || messages.length === 0) continue;

      // Route on the DESTINATION: the Cloud-API phone_number_id identifies which
      // registered organization number (and therefore which tenant) was messaged.
      // Deliberately cross-tenant — this IS the lookup that resolves which
      // tenant a message belongs to, so no tenant context can exist yet.
      // Found broken (silently — this whole block runs inside a
      // .catch(() => {}), so it was dropping every real inbound WhatsApp
      // message with no visible error) by the 2026-08-23 fail-closed
      // rollout: real channel webhooks' pre-context lookups are a category
      // the choke-point audit missed entirely, since scripts/test.ts
      // exercises a separate test-only /api/channels/webchat endpoint that
      // never goes through this real lookup.
      const orgNumber = await runCrossTenant(() => db.whatsAppNumber.findUnique({ where: { phoneNumberId } }));
      if (!orgNumber) continue;

      for (const m of messages) {
        if (!m.from) continue;
        if (!["text", "audio", "document", "image"].includes(m.type ?? "")) continue;
        if (!firstTimeSeeing(m.id)) continue; // skip Meta re-deliveries
        const name = value?.contacts?.[0]?.profile?.name;
        if (m.id) await sendTyping(phoneNumberId, m.id); // show "typing…" while we work

        let text = m.text?.body ?? "";
        let attachment: { base64: string; filename: string; mimeType: string } | undefined;

        // Voice notes: download the audio and transcribe it, so the user can TALK.
        if (m.type === "audio") {
          const media = m.audio?.id ? await fetchWhatsAppMedia(m.audio.id, phoneNumberId) : null;
          const transcript = media ? await transcribeAudio(media.base64, media.mimeType) : null;
          if (!transcript) {
            await sendWhatsAppText(phoneNumberId, m.from, "Sorry, I couldn't quite catch that voice note 🙏 Could you type it out or send it again?");
            continue;
          }
          text = transcript;
        }

        // Files (documents / images): download and pass as an attachment for a tool.
        if (m.type === "document" || m.type === "image") {
          const mediaId = m.type === "document" ? m.document?.id : m.image?.id;
          const filename = m.type === "document" ? m.document?.filename : undefined; // images have no filename from WhatsApp
          const caption = m.type === "document" ? m.document?.caption : m.image?.caption;
          const dl = mediaId ? await fetchWhatsAppMedia(mediaId, phoneNumberId) : null;
          if (!dl) {
            await sendWhatsAppText(phoneNumberId, m.from, "I couldn't open that file 🙏 Could you send it again?");
            continue;
          }
          attachment = { base64: dl.base64, filename: filename || `file.${dl.mimeType.split("/")[1] || "bin"}`, mimeType: dl.mimeType };
          text = caption ?? "";
        }

        if (!text.trim() && !attachment) continue;

        await handleInbound({
          toNumber: orgNumber.phoneNumber ?? undefined, // the organization's own number — real inbound traffic implies this is set, but the field is nullable during the "connecting" window
          fromNumber: m.from, // the sender
          channelType: "whatsapp",
          text,
          displayName: name,
          attachment,
        });
      }
    }
  }
}
