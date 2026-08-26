import "server-only";
import path from "node:path";
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
// be banned without warning or appeal — see GAP-REGISTER for the full,
// deliberate reasoning. Never used for a number without an explicit,
// confirmed switch action from the tenant (see switchWhatsAppTransportAction
// in actions.ts).
//
// The `@whiskeysockets/baileys` package is NOT a dependency of this project
// yet (installing it was blocked by this environment's own safety
// classifier — see project history). Every use of it below goes through a
// dynamic import inside a function body, never a static top-level import, so
// the rest of the app keeps compiling and running normally whether or not
// the package is actually present in node_modules. The moment it's
// installed, this file works with no changes.
//
// UNTESTED — written against Baileys' publicly documented API shape, never
// run against a real socket (the package isn't installed in this
// environment). Confirm the exact event/method names against the installed
// version's own types before trusting this in production.
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_DIR_ROOT = process.env.BAILEYS_AUTH_DIR || "/data/baileys-auth";

type BaileysSocket = {
  ev: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
  };
  user?: { id: string };
  sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
  end?: (error?: Error) => void;
};

type Registry = {
  sockets: Map<string, BaileysSocket>;
  pendingQr: Map<string, { qr: string; expiresAt: number }>;
  starting: Set<string>;
};

// globalThis-backed, same rationale as job-runner.ts's REGISTRY (line 27-29):
// module-scoped state doesn't survive across Next.js's separate bundles for
// the instrumentation hook vs. server actions vs. API routes — each gets its
// own module instance, so a live socket opened from one bundle would look
// nonexistent from another.
const holder = globalThis as unknown as { __p2lessBaileys?: Registry };
holder.__p2lessBaileys ??= { sockets: new Map(), pendingQr: new Map(), starting: new Set() };
const REGISTRY = holder.__p2lessBaileys;

const QR_TTL_MS = 60_000; // Baileys itself rotates the QR roughly this often

function authDir(numberId: string): string {
  return path.join(AUTH_DIR_ROOT, numberId);
}

/** Extract the E.164 phone number from a Baileys JID (e.g.
 *  "254711562526:12@s.whatsapp.net" or "254711562526@s.whatsapp.net"). */
function phoneFromJid(jid: string): string {
  const digits = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return "+" + digits;
}

/** Extract the plain text body from a Baileys message object, across the
 *  couple of shapes a real inbound text/caption can take. Returns null for
 *  message types this transport doesn't handle yet (media-only, reactions,
 *  etc.) — mirrors the official webhook route's own type == "text" gate. */
function extractText(msg: Record<string, unknown>): string | null {
  const m = msg.message as Record<string, unknown> | undefined;
  if (!m) return null;
  const conversation = m.conversation as string | undefined;
  const extended = (m.extendedTextMessage as { text?: string } | undefined)?.text;
  return conversation ?? extended ?? null;
}

/** Start (or resume, from persisted auth state) a Baileys connection for one
 *  WhatsAppNumber. Safe to call more than once for the same numberId — a
 *  `starting` guard (same double-start-guard shape as job-runner.ts's
 *  startJobPoller, line 91-101) makes repeat calls (e.g. Next dev-mode hot
 *  reload, or the dashboard polling loop re-triggering a connect) a no-op
 *  once a socket is already up or already being brought up. */
export async function startBaileysConnection(numberId: string): Promise<void> {
  if (REGISTRY.sockets.has(numberId) || REGISTRY.starting.has(numberId)) return;
  REGISTRY.starting.add(numberId);

  try {
    // A non-literal specifier keeps TypeScript from trying to resolve real
    // type declarations for a package that may not be installed in every
    // environment (see this file's header comment) — this import is
    // intentionally untyped (`any`) at compile time; every value pulled out
    // of it below is cast to a local, hand-written minimal type instead.
    const BAILEYS_PKG = "@whiskeysockets/baileys";
    const baileys = await import(BAILEYS_PKG);
    const makeWASocket = (baileys.default ?? baileys) as unknown as (opts: Record<string, unknown>) => BaileysSocket;
    const { useMultiFileAuthState, DisconnectReason } = baileys as unknown as {
      useMultiFileAuthState: (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
      DisconnectReason: { loggedOut: number };
    };

    const { state, saveCreds } = await useMultiFileAuthState(authDir(numberId));
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });
    REGISTRY.sockets.set(numberId, sock);

    sock.ev.on("creds.update", () => { void saveCreds(); });

    sock.ev.on("connection.update", (...args: unknown[]) => {
      const update = args[0] as { connection?: string; qr?: string; lastDisconnect?: { error?: { output?: { statusCode?: number } } } };
      void handleConnectionUpdate(numberId, sock, update, DisconnectReason?.loggedOut);
    });

    sock.ev.on("messages.upsert", (...args: unknown[]) => {
      const payload = args[0] as { messages?: Record<string, unknown>[]; type?: string };
      void handleInboundMessages(numberId, payload);
    });
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
async function handleConnectionUpdate(
  numberId: string,
  sock: BaileysSocket,
  update: { connection?: string; qr?: string; lastDisconnect?: { error?: { output?: { statusCode?: number } } } },
  loggedOutCode: number | undefined,
): Promise<void> {
  return runCrossTenant(() => handleConnectionUpdateInner(numberId, sock, update, loggedOutCode));
}

async function handleConnectionUpdateInner(
  numberId: string,
  sock: BaileysSocket,
  update: { connection?: string; qr?: string; lastDisconnect?: { error?: { output?: { statusCode?: number } } } },
  loggedOutCode: number | undefined,
): Promise<void> {
  if (update.qr) {
    REGISTRY.pendingQr.set(numberId, { qr: update.qr, expiresAt: Date.now() + QR_TTL_MS });
  }

  if (update.connection === "open") {
    REGISTRY.pendingQr.delete(numberId);
    const phoneNumber = sock.user?.id ? phoneFromJid(sock.user.id) : null;
    const number = await db.whatsAppNumber.findUnique({ where: { id: numberId } });
    if (!number) return;
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
    const statusCode = update.lastDisconnect?.error?.output?.statusCode;
    // A logged-out disconnect (the phone unlinked this device) is terminal —
    // don't auto-reconnect into a fresh QR loop unattended. Any other close
    // reason (network blip, server restart) is worth one reconnect attempt.
    if (statusCode !== loggedOutCode) {
      void startBaileysConnection(numberId);
    } else {
      const number = await db.whatsAppNumber.findUnique({ where: { id: numberId } });
      if (number) {
        await db.whatsAppNumber.update({ where: { id: numberId }, data: { verificationStatus: "pending" } }).catch(() => {});
      }
    }
  }
}

async function handleInboundMessages(numberId: string, payload: { messages?: Record<string, unknown>[]; type?: string }): Promise<void> {
  return runCrossTenant(() => handleInboundMessagesInner(numberId, payload));
}

async function handleInboundMessagesInner(numberId: string, payload: { messages?: Record<string, unknown>[]; type?: string }): Promise<void> {
  if (payload.type !== "notify" || !payload.messages) return;
  const number = await db.whatsAppNumber.findUnique({ where: { id: numberId } });
  if (!number?.phoneNumber) return;

  for (const msg of payload.messages) {
    const key = msg.key as { fromMe?: boolean; remoteJid?: string } | undefined;
    if (!key || key.fromMe || !key.remoteJid) continue;
    const text = extractText(msg);
    if (!text) continue;

    const { handleInbound } = await import("./conversation");
    const result = await handleInbound({
      toNumber: number.phoneNumber,
      fromNumber: phoneFromJid(key.remoteJid),
      channelType: "whatsapp",
      text,
      displayName: (msg.pushName as string | undefined) ?? undefined,
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

/** Cleanly end a socket (used when switching a number FROM the unofficial
 *  transport back to Meta) — does not delete the persisted auth state, so a
 *  future re-pairing attempt for the same number starts from a clean slate
 *  rather than a half-torn-down session. */
export async function stopBaileysConnection(numberId: string): Promise<void> {
  const sock = REGISTRY.sockets.get(numberId);
  sock?.end?.();
  REGISTRY.sockets.delete(numberId);
  REGISTRY.pendingQr.delete(numberId);
}
