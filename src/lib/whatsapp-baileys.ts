import "server-only";
import path from "node:path";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, type WASocket, type ConnectionState, type WAMessage, type MessageUpsertType } from "@whiskeysockets/baileys";
import { db } from "./db";
import { audit } from "./audit";
import { requestId as newRequestId } from "./crypto";
import { runCrossTenant } from "./tenant-context";

// ─────────────────────────────────────────────────────────────────────────────
// Unofficial WhatsApp transport, 2026-08-26 — an alternative to the official
// Business Cloud API (transport.ts/the /api/channels/whatsapp/webhook route)
// for a WhatsAppNumber with `transport: "unofficial"`. Device-paired via QR
// code (same trust model as WhatsApp Web itself — no password, no Meta
// registration), backed by Baileys, a real WebSocket connection to WhatsApp
// per number.
//
// KNOWN, ACCEPTED TRADEOFF: this violates WhatsApp's Terms of Service and can
// be banned without warning or appeal — see GAP-REGISTER item 16 for the
// full, deliberate reasoning. Never used for a number without an explicit,
// confirmed switch action from the tenant (see switchWhatsAppTransportAction
// in actions.ts).
//
// Written against @whiskeysockets/baileys 7.0.0-rc14's real, installed type
// declarations (confirmed via node_modules, not guessed) — but the actual
// socket/QR/send behavior has still never been run against a real WhatsApp
// account. Confirm live before fully trusting this in production.
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_DIR_ROOT = process.env.BAILEYS_AUTH_DIR || "/data/baileys-auth";

type Registry = {
  sockets: Map<string, WASocket>;
  pendingQr: Map<string, { qr: string; expiresAt: number }>;
  pendingPairingCode: Map<string, { code: string; expiresAt: number }>;
  starting: Set<string>;
};

// globalThis-backed, same rationale as job-runner.ts's REGISTRY: module-scoped
// state doesn't survive across Next.js's separate bundles for the
// instrumentation hook vs. server actions vs. API routes — each gets its own
// module instance, so a live socket opened from one bundle would look
// nonexistent from another.
const holder = globalThis as unknown as { __p2lessBaileys?: Registry };
holder.__p2lessBaileys ??= { sockets: new Map(), pendingQr: new Map(), pendingPairingCode: new Map(), starting: new Set() };
const REGISTRY = holder.__p2lessBaileys;

const QR_TTL_MS = 60_000; // Baileys itself rotates the QR roughly this often

function authDir(numberId: string): string {
  return path.join(AUTH_DIR_ROOT, numberId);
}

/** Baileys' Contact.id is now "lid or jid format (preferred)" per its own
 *  type comment — WhatsApp's migration to opaque LIDs means it may no longer
 *  be a phone-number JID at all. Contact.phoneNumber (when present) is the
 *  reliable source; falling back to digit-extraction from id/a JID string
 *  only covers the classic "<digits>@s.whatsapp.net" shape, which is still
 *  common but not guaranteed going forward — a real limitation, not
 *  papered over. */
// Minimal no-op logger satisfying Baileys' ILogger contract — only needed
// to unlock downloadMediaMessage's reuploadRequest option below; this
// module's own error handling (try/catch around every download) already
// surfaces real failures via console.error, so there's nothing useful for
// Baileys' internal logger to add here.
const silentLogger = { level: "silent", child: () => silentLogger, trace() {}, debug() {}, info() {}, warn() {}, error() {} };

function phoneFromJid(jid: string): string {
  const digits = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return "+" + digits;
}

/** Extract the plain text body from a Baileys message object, across the
 *  couple of shapes a real inbound text/caption can take. Returns null for
 *  message types this transport doesn't handle yet (media-only, reactions,
 *  etc.) — mirrors the official webhook route's own type == "text" gate. */
function extractText(msg: { message?: { conversation?: string | null; extendedTextMessage?: { text?: string | null } | null } | null }): string | null {
  const m = msg.message;
  if (!m) return null;
  return m.conversation ?? m.extendedTextMessage?.text ?? null;
}

/** Download a Baileys media message to base64 — the unofficial transport's
 *  equivalent of transport.ts's fetchWhatsAppMedia (Meta's two-hop id→URL→
 *  bytes fetch). Baileys hands back the bytes directly, already decrypted;
 *  reuploadRequest lets it transparently re-fetch media whose direct link
 *  expired (the exact case the library's own docs call out), same
 *  reliability the official transport gets from re-hitting the Graph API. */
async function downloadBaileysMedia(sock: WASocket, msg: WAMessage, mimeType: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const buf = await downloadMediaMessage(msg, "buffer", {}, { reuploadRequest: sock.updateMediaMessage, logger: silentLogger });
    return { base64: buf.toString("base64"), mimeType };
  } catch (e) {
    console.error("[whatsapp-baileys:media-download-failed]", e);
    return null;
  }
}

/** Start (or resume, from persisted auth state) a Baileys connection for one
 *  WhatsAppNumber. Safe to call more than once for the same numberId — a
 *  `starting` guard (same double-start-guard shape as job-runner.ts's
 *  startJobPoller) makes repeat calls (e.g. Next dev-mode hot reload, or the
 *  dashboard polling loop re-triggering a connect) a no-op once a socket is
 *  already up or already being brought up. */
// `pairingPhoneNumber`, when given, requests a typed pairing code instead of
// relying on the QR — for a phone whose camera can't scan one. E.164 digits,
// no "+". Baileys emits BOTH a QR (still stored, harmless if unused) and,
// when asked, a short code the person types into WhatsApp's own "Link with
// phone number" flow — same underlying pairing handshake either way.
export async function startBaileysConnection(numberId: string, pairingPhoneNumber?: string): Promise<void> {
  if (REGISTRY.sockets.has(numberId) || REGISTRY.starting.has(numberId)) return;
  REGISTRY.starting.add(numberId);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir(numberId));
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });
    REGISTRY.sockets.set(numberId, sock);

    sock.ev.on("creds.update", () => { void saveCreds(); });
    sock.ev.on("connection.update", (update) => { void handleConnectionUpdate(numberId, sock, update); });
    sock.ev.on("messages.upsert", (payload) => { void handleInboundMessages(numberId, payload); });

    if (pairingPhoneNumber && !state.creds.registered) {
      const digits = pairingPhoneNumber.replace(/\D/g, "");
      // requestPairingCode needs the socket's underlying WebSocket handshake
      // to have completed first — calling it immediately after
      // makeWASocket() (before that handshake finishes) fails with a real
      // "Connection Closed" 428, confirmed live. A short retry/backoff
      // covers the handshake's actual completion time without needing to
      // hook a specific Baileys-internal readiness event.
      void (async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise((r) => setTimeout(r, attempt === 0 ? 300 : 1500));
          try {
            const code = await sock.requestPairingCode(digits);
            REGISTRY.pendingPairingCode.set(numberId, { code, expiresAt: Date.now() + QR_TTL_MS });
            return;
          } catch (e) {
            if (attempt === 4) console.error(`[whatsapp-baileys:pairing-code-failed ${numberId}]`, e);
          }
        }
      })();
    }
  } catch (e) {
    console.error(`[whatsapp-baileys:start-failed ${numberId}]`, e);
    REGISTRY.sockets.delete(numberId);
  } finally {
    REGISTRY.starting.delete(numberId);
  }
}

// Baileys' own `.on()` event callbacks are detached from whatever request
// (or boot-time) call stack originally invoked startBaileysConnection() —
// Node's AsyncLocalStorage does not propagate into an independent event-
// listener firing, so every DB call here re-establishes its own context, the
// same way the real WhatsApp webhook route's processEvents() does (see
// src/app/api/channels/whatsapp/webhook/route.ts) — never inherited.
async function handleConnectionUpdate(numberId: string, sock: WASocket, update: Partial<ConnectionState>): Promise<void> {
  return runCrossTenant(() => handleConnectionUpdateInner(numberId, sock, update));
}

async function handleConnectionUpdateInner(numberId: string, sock: WASocket, update: Partial<ConnectionState>): Promise<void> {
  if (update.qr) {
    REGISTRY.pendingQr.set(numberId, { qr: update.qr, expiresAt: Date.now() + QR_TTL_MS });
  }

  if (update.connection === "open") {
    REGISTRY.pendingQr.delete(numberId);
    REGISTRY.pendingPairingCode.delete(numberId);
    const phoneNumber = sock.user?.phoneNumber ?? (sock.user?.id ? phoneFromJid(sock.user.id) : null);
    const number = await db.whatsAppNumber.findUnique({ where: { id: numberId } });
    if (!number) return;

    // Never let the same physical number end up actively connected on both
    // transports (or twice on the unofficial one) at once — WhatsAppNumber.
    // phoneNumber is DB-unique, so writing a colliding number without this
    // check would crash on a raw Prisma constraint error, leave the
    // orphaned Baileys session paired with nothing recording it, and never
    // tell the tenant why. A conflicting row only blocks this pairing while
    // it's genuinely still holding the number ("verified"/"connecting");
    // once the other side is disconnected ("pending"/"failed"), the number
    // is free again — matching "unless it is disconnected on the other."
    if (phoneNumber) {
      const conflict = await db.whatsAppNumber.findFirst({
        where: { phoneNumber, id: { not: numberId }, verificationStatus: { in: ["verified", "connecting"] } },
      });
      if (conflict) {
        console.error(`[whatsapp-baileys:duplicate-number ${numberId}] ${phoneNumber} is already connected on number ${conflict.id} (transport: ${conflict.transport})`);
        await sock.logout(`Already connected to P2Less on another number (${conflict.transport}).`).catch(() => {});
        REGISTRY.sockets.delete(numberId);
        await db.whatsAppNumber.update({ where: { id: numberId }, data: { verificationStatus: "failed" } }).catch(() => {});
        await audit({
          tenantId: number.tenantId,
          requestId: newRequestId(),
          actorType: "system",
          action: "whatsapp.unofficial_connect_rejected_duplicate",
          target: numberId,
          success: false,
          detail: { phoneNumber, conflictingNumberId: conflict.id, conflictingTransport: conflict.transport },
        }).catch(() => {});
        return;
      }
    }

    await db.whatsAppNumber.update({
      where: { id: numberId },
      data: {
        phoneNumber: phoneNumber ?? number.phoneNumber,
        verificationStatus: "verified",
        // A real, unique phoneNumberId is what every lookup in this codebase
        // (transport.ts's deliver(), sendTyping, etc.) keys on — a Baileys
        // number never has a real Meta Graph API id, so it gets a synthetic
        // one here, once, at first successful pairing. Left untouched on
        // reconnects (number.phoneNumberId already set).
        phoneNumberId: number.phoneNumberId ?? `baileys:${numberId}`,
      },
    });
    await audit({
      tenantId: number.tenantId,
      requestId: newRequestId(),
      actorType: "system",
      action: "whatsapp.unofficial_connected",
      target: numberId,
      success: true,
      detail: { phoneNumber: phoneNumber ?? number.phoneNumber },
    }).catch(() => {});
  }

  if (update.connection === "close") {
    REGISTRY.sockets.delete(numberId);
    REGISTRY.pendingPairingCode.delete(numberId);
    const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
    // A logged-out disconnect (the phone unlinked this device) is terminal —
    // don't auto-reconnect into a fresh QR loop unattended. Any other close
    // reason (network blip, server restart) is worth one reconnect attempt.
    if (statusCode !== DisconnectReason.loggedOut) {
      void startBaileysConnection(numberId);
    } else {
      await db.whatsAppNumber.update({ where: { id: numberId }, data: { verificationStatus: "pending" } }).catch(() => {});
    }
  }
}

type MessagesUpsertPayload = { messages: WAMessage[]; type: MessageUpsertType; requestId?: string };

async function handleInboundMessages(numberId: string, payload: MessagesUpsertPayload): Promise<void> {
  return runCrossTenant(() => handleInboundMessagesInner(numberId, payload));
}

async function handleInboundMessagesInner(numberId: string, payload: MessagesUpsertPayload): Promise<void> {
  if (payload.type !== "notify") return;
  const number = await db.whatsAppNumber.findUnique({ where: { id: numberId } });
  if (!number?.phoneNumber) return;

  for (const msg of payload.messages) {
    const key = msg.key;
    if (!key || key.fromMe || !key.remoteJid) continue;
    const m = msg.message;
    if (!m) continue;

    // Same four inbound shapes the official Meta transport already handles
    // (text / audio / document / image) — everything else (video, stickers,
    // location, reactions, ...) this transport doesn't handle yet, same as
    // the official webhook route's own type-allowlist gate.
    const imageMsg = m.imageMessage;
    const audioMsg = m.audioMessage;
    const documentMsg = m.documentMessage;
    if (!m.conversation && !m.extendedTextMessage && !imageMsg && !audioMsg && !documentMsg) continue;

    const sockForFetch = REGISTRY.sockets.get(numberId);
    if (!sockForFetch) continue;

    // Blue ticks (read receipt) + "typing…" indicator — the official Meta
    // transport gets both via transport.ts's sendTyping() hitting Graph API
    // directly (its one call marks read AND shows typing together); Baileys
    // has no equivalent REST call, each is its own call over the socket
    // itself. Grey ticks (sent/delivered) happen automatically as part of
    // WhatsApp's own delivery protocol regardless of what P2Less does — only
    // the blue "read" tick needed an explicit call. Both best-effort: a real
    // user-visible cue while handleInbound's AI/connector work runs (which
    // can take a few seconds), never worth blocking or failing the actual
    // reply over.
    await sockForFetch.readMessages([key]).catch(() => {});
    await sockForFetch.sendPresenceUpdate("composing", key.remoteJid).catch(() => {});

    let text = extractText(msg) ?? "";
    let attachment: { base64: string; filename: string; mimeType: string } | undefined;

    // Voice notes: download and transcribe, same as the official transport —
    // so the user can TALK, not just type, regardless of which transport
    // their number happens to be on.
    if (audioMsg) {
      const media = await downloadBaileysMedia(sockForFetch, msg, audioMsg.mimetype || "audio/ogg");
      const { transcribeAudio } = await import("./ai");
      const transcript = media ? await transcribeAudio(media.base64, media.mimeType) : null;
      if (!transcript) {
        await sockForFetch.sendMessage(key.remoteJid, { text: "Sorry, I couldn't quite catch that voice note 🙏 Could you type it out or send it again?" }).catch(() => {});
        continue;
      }
      text = transcript;
    }

    // Photos and documents: download and pass as an attachment for a tool
    // (image-vision.ts / document-intel.ts pick it up from there) — same
    // dispatch conversation.ts's handleInbound already uses for Meta.
    if (imageMsg || documentMsg) {
      const mimeType = (imageMsg?.mimetype || documentMsg?.mimetype) || "application/octet-stream";
      const media = await downloadBaileysMedia(sockForFetch, msg, mimeType);
      if (!media) {
        await sockForFetch.sendMessage(key.remoteJid, { text: "I couldn't open that file 🙏 Could you send it again?" }).catch(() => {});
        continue;
      }
      const filename = documentMsg?.fileName || `file.${mimeType.split("/")[1] || "bin"}`;
      attachment = { base64: media.base64, filename, mimeType: media.mimeType };
      text = (imageMsg?.caption || documentMsg?.caption || "") ?? "";
    }

    if (!text.trim() && !attachment) continue;

    // handleInbound's own emit() already sends every reply via deliver()
    // (which branches to sendBaileysMessage() for this transport, see
    // transport.ts) — a real, previously-live double-send bug was found and
    // fixed here 2026-08-26: this loop used to ALSO manually re-send every
    // reply after handleInbound already sent it once internally, meaning
    // every message on a Baileys-connected number went out twice. There is
    // deliberately no reply-sending code below this call anymore.
    const { handleInbound } = await import("./conversation");
    await handleInbound({
      toNumber: number.phoneNumber,
      fromNumber: phoneFromJid(key.remoteJid),
      channelType: "whatsapp",
      text,
      displayName: msg.pushName ?? undefined,
      attachment,
      inputWasVoice: !!audioMsg,
    });

    await sockForFetch.sendPresenceUpdate("paused", key.remoteJid).catch(() => {});
  }
}

/** Called once from instrumentation.ts's register() — re-opens a socket from
 *  persisted auth state for every WhatsAppNumber already on the unofficial
 *  transport, so a process restart resumes existing connections instead of
 *  forcing every one of them through a fresh QR scan. */
export async function rehydrateAllBaileysConnections(): Promise<void> {
  const numbers = await runCrossTenant(() => db.whatsAppNumber.findMany({
    where: { transport: "unofficial" },
    select: { id: true },
  }));
  for (const n of numbers) {
    void startBaileysConnection(n.id);
  }
}

/** Polled by the dashboard while the connect/switch Modal is open. Returns
 *  null once pairing has completed (verificationStatus flips to "verified")
 *  or the QR has rotated out — the caller re-polls to pick up the next one. */
export async function getPendingQr(numberId: string): Promise<string | null> {
  const entry = REGISTRY.pendingQr.get(numberId);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.qr;
}

export async function getPendingPairingCode(numberId: string): Promise<string | null> {
  const entry = REGISTRY.pendingPairingCode.get(numberId);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.code;
}

export async function isBaileysConnected(numberId: string): Promise<boolean> {
  return REGISTRY.sockets.has(numberId);
}

/** Used by transport.ts's deliver() for an outbound reply on a number whose
 *  transport is "unofficial". `to` is the recipient's E.164 number. */
export async function sendBaileysMessage(
  numberId: string, to: string, body: string,
  opts?: { document?: { url: string; filename: string }; voiceBuffer?: Buffer },
): Promise<{ delivered: boolean; error?: string }> {
  const sock = REGISTRY.sockets.get(numberId);
  if (!sock) return { delivered: false, error: "No active unofficial WhatsApp connection for this number" };
  try {
    const jid = `${to.replace(/\D/g, "")}@s.whatsapp.net`;
    // Voice reply — a real audio buffer already synthesized by the caller
    // (transport.ts's deliver()). ptt:true is what makes WhatsApp render
    // this as a voice-note bubble (waveform, hold-to-play) rather than a
    // generic audio-file attachment. No caption — same "voice-only, no
    // typed-out duplicate" choice the official transport makes.
    if (opts?.voiceBuffer) {
      await sock.sendMessage(jid, { audio: opts.voiceBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true });
      return { delivered: true };
    }
    // Document reply (e.g. a payslip/leave-confirmation PDF) — Baileys
    // fetches the URL itself, same as the official transport's link-based
    // send; this closes a real pre-existing gap where a document Reply had
    // no delivery path at all on the unofficial transport.
    if (opts?.document) {
      await sock.sendMessage(jid, { document: { url: opts.document.url }, fileName: opts.document.filename, mimetype: "application/pdf", caption: body });
      return { delivered: true };
    }
    await sock.sendMessage(jid, { text: body });
    return { delivered: true };
  } catch (e) {
    return { delivered: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

/** Platform kill switch, 2026-08-26 — same shape/naming as
 *  embeddedSignupConfigured() (whatsapp-embedded-signup.ts), but backed by
 *  the whatsapp_baileys Integration row instead of env vars, since this is
 *  an admin on/off decision, not an environment-configuration one. Gates
 *  BOTH dashboard entry points (a brand-new "Connect via alternative" and
 *  the "Switch to alternative" direction on an already-connected number —
 *  see /dashboard/channels/page.tsx) and, separately, real sends (the
 *  matching check in transport.ts's deliver()) — disabling this stops the
 *  option from being offered at all, not just from being started fresh. */
export async function whatsappUnofficialTransportEnabled(): Promise<boolean> {
  const integration = await db.integration.findUnique({ where: { key: "whatsapp_baileys" }, select: { enabled: true } });
  return integration?.enabled ?? true;
}

/** Cleanly end a socket (used when switching a number FROM the unofficial
 *  transport back to Meta) — does not delete the persisted auth state, so a
 *  future re-pairing attempt for the same number starts from a clean slate
 *  rather than a half-torn-down session. */
export async function stopBaileysConnection(numberId: string): Promise<void> {
  const sock = REGISTRY.sockets.get(numberId);
  if (sock) await sock.end(undefined);
  REGISTRY.sockets.delete(numberId);
  REGISTRY.pendingQr.delete(numberId);
  REGISTRY.pendingPairingCode.delete(numberId);
}
