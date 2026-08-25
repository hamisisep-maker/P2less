import "server-only";
import { db } from "./db";
import { encryptJSON, decryptJSON, randomToken } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 8d — see docs/ROADMAP-UNIVERSAL-PLATFORM-
// 2026-08-19.md. Telegram Bot API — Mode 1 (customer messages first), same
// engine as WhatsApp/Messenger/webchat.
//
// Genuinely simpler to connect than WhatsApp/Messenger: no OAuth, no App
// Review, no platform-wide app credentials at all — each tenant brings their
// own bot token, created instantly via Telegram's own @BotFather. Confirmed
// against Telegram's real Bot API docs before writing this, not guessed.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.telegram.org";

function publicBaseUrl(): string | null {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base || null;
}

type TelegramMe = { id: number; is_bot: boolean; first_name: string; username?: string };

/** Validates a pasted bot token, registers our webhook for it (with a fresh
 *  per-channel secret Telegram echoes back on every delivery so we can tell
 *  a request genuinely came from Telegram), and persists the Channel row —
 *  the same generic "channel resource" model WhatsApp/Messenger already use,
 *  not a new table. One bot per tenant today (`@@unique([tenantId, type])`),
 *  same stated v1 limit as Messenger's one-Page-per-tenant. */
export async function connectTelegramBot(tenantId: string, botToken: string): Promise<{ ok: true; username?: string } | { ok: false; error: string }> {
  const token = botToken.trim();
  if (!token) return { ok: false, error: "Paste a real bot token from @BotFather first." };

  const base = publicBaseUrl();
  if (!base) return { ok: false, error: "PUBLIC_BASE_URL isn't configured on this deployment yet — Telegram needs a real public URL to deliver messages to." };

  const meRes = await fetch(`${API_BASE}/bot${token}/getMe`);
  const meBody = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !meBody?.ok || !meBody?.result) {
    return { ok: false, error: meBody?.description || "That doesn't look like a valid bot token — check it against @BotFather and try again." };
  }
  const me = meBody.result as TelegramMe;

  const webhookSecret = randomToken(24);
  const channel = await db.channel.upsert({
    where: { tenantId_type: { tenantId, type: "telegram" } },
    create: { tenantId, type: "telegram", address: String(me.id), status: "active", connectionStatus: "connecting", config: { botUsername: me.username, tokenEnc: encryptJSON({ token }), webhookSecret } },
    update: { address: String(me.id), status: "active", connectionStatus: "connecting", config: { botUsername: me.username, tokenEnc: encryptJSON({ token }), webhookSecret } },
  });

  const webhookUrl = `${base}/api/channels/telegram/webhook/${channel.id}`;
  const setRes = await fetch(`${API_BASE}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: webhookSecret, drop_pending_updates: true }),
  });
  const setBody = await setRes.json().catch(() => ({}));
  if (!setRes.ok || !setBody?.ok) {
    // The bot itself is saved and real — only the webhook registration failed.
    // Mirrors Messenger's own "Page saved, subscription can be retried"
    // partial-failure shape rather than pretending the whole thing failed.
    // `status` stays "active" (the channel IS eligible to route once fixed);
    // `connectionStatus` carries the "but something's wrong" signal instead.
    await db.channel.update({ where: { id: channel.id }, data: { connectionStatus: "needs_attention" } });
    return { ok: false, error: setBody?.description || "Bot verified, but registering the webhook with Telegram failed. Try connecting again." };
  }

  await db.channel.update({ where: { id: channel.id }, data: { connectionStatus: "connected" } });

  return { ok: true, username: me.username };
}

export async function resolveTelegramToken(botId: string): Promise<string | null> {
  const channel = await db.channel.findFirst({ where: { type: "telegram", address: botId, status: "active" } });
  const cfg = channel?.config as { tokenEnc?: string } | null;
  const decrypted = decryptJSON<{ token?: string }>(cfg?.tokenEnc);
  return decrypted?.token ?? null;
}

/** Send a plain Telegram text message. Telegram's Bot API has no 24-hour
 *  session-window restriction WhatsApp has — a bot can message any chat that
 *  has ever started a conversation with it, at any time. */
export async function sendTelegramText(token: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.ok) return { ok: false, error: body?.description || `sendMessage failed (${res.status})` };
    return { ok: true };
  } catch {
    return { ok: false, error: "network error" };
  }
}
