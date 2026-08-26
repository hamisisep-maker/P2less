import "server-only";
import path from "node:path";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, type WASocket, type ConnectionState, type WAMessage, type MessageUpsertType } from "@whiskeysockets/baileys";
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
  starting: Set<string>;
};

// globalThis-backed, same rationale as job-runner.ts's REGISTRY: module-scoped
// state doesn't survive across Next.js's separate bundles for the
// instrumentation hook vs. server actions vs. API routes — each gets its own
// module instance, so a live socket opened from one bundle would look
// nonexistent from another.
const holder = globalThis as unknown as { __p2lessBaileys?: Registry };
holder.__p2lessBaileys ??= { sockets: new Map(), pendingQr: new Map(), starting: new Set() };
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

/** Start (or resume, from persisted auth state) a Baileys connection for one
 *  WhatsAppNumber. Safe to call more than once for the same numberId — a
 *  `starting` guard (same double-start-guard shape as job-runner.ts's
 *  startJobPoller) makes repeat calls (e.g. Next dev-mode hot reload, or the
 *  dashboard polling loop re-triggering a connect) a no-op once a socket is
 *  already up or already being brought up. */
export async function startBaileysConnection(numberId: string): Promise<void> {
  if (REGISTRY.sockets.has(numberId) || REGISTRY.starting.has(numberId)) return;
  REGISTRY.starting.add(numberId);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir(numberId));
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });
    REGISTRY.sockets.set(numberId, sock);

    sock.ev.on("creds.update", () => { void saveCreds(); });
    sock.ev.on("connection.update", (update) => { void handleConnectionUpdate(numberId, sock, update); });
    sock.ev.on("messages.upsert", (payload) => { void handleInboundMessages(numberId, payload); });
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
    const text = extractText(msg);
    if (!text) continue;

    const { handleInbound } = await import("./conversation");
    const result = await handleInbound({
      toNumber: number.phoneNumber,
      fromNumber: phoneFromJid(key.remoteJid),
      channelType: "whatsapp",
      text,
      displayName: msg.pushName ?? undefined,
    });

    const sock = REGISTRY.sockets.get(numberId);
    if (!sock) continue;
    for (const reply of result.replies) {
      await sock.sendMessage(key.remoteJid, { text: reply.body }).catch((e) => {
        console.error(`[whatsapp-baileys:send-failed ${numberId}]`, e);
      });
    }
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

export async function isBaileysConnected(numberId: string): Promise<boolean> {
  return REGISTRY.sockets.has(numberId);
}

/** Used by transport.ts's deliver() for an outbound reply on a number whose
 *  transport is "unofficial". `to` is the recipient's E.164 number. */
export async function sendBaileysMessage(numberId: string, to: string, body: string): Promise<{ delivered: boolean; error?: string }> {
  const sock = REGISTRY.sockets.get(numberId);
  if (!sock) return { delivered: false, error: "No active unofficial WhatsApp connection for this number" };
  try {
    const digits = to.replace(/\D/g, "");
    await sock.sendMessage(`${digits}@s.whatsapp.net`, { text: body });
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
}
