import { handleInbound } from "@/lib/conversation";
import { db } from "@/lib/db";
import { recordInboundEvent, finishInboundEvent } from "@/lib/inbound-events";

// ─────────────────────────────────────────────────────────────────────────────
// Telegram channel adapter — Phase 8d. Same shared engine as every other
// channel; the only Telegram-specific code is parsing the Update payload
// (confirmed against Telegram's own Bot API docs before writing this) and
// routing to the same handleInbound().
//
// Unlike WhatsApp/Messenger's ONE shared app-level webhook (disambiguated by
// phone_number_id/page_id inside the payload), Telegram's Update object
// carries no identifier for which bot received it — Telegram only knows
// "deliver to whichever URL this bot's webhook is registered to". So the
// webhook URL itself is per-channel (telegram.ts's connectTelegramBot() sets
// it to this exact path with the Channel's own id), which is what
// disambiguates tenants here instead.
//
// v1 scope, stated not silent: text messages only. No media, no inline
// keyboards/commands — the same bounded first slice every other Mode 1
// channel started with.
// ─────────────────────────────────────────────────────────────────────────────

type TelegramUpdate = {
  update_id?: number;
  message?: { message_id?: number; text?: string; chat?: { id?: number } };
};

export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const raw = await req.text();

  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.type !== "telegram" || channel.status !== "active") {
    return new Response("Not found", { status: 404 });
  }
  const cfg = channel.config as { webhookSecret?: string } | null;
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  if (!cfg?.webhookSecret || secretHeader !== cfg.webhookSecret) {
    return new Response("Forbidden", { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = JSON.parse(raw) as TelegramUpdate;
  } catch {
    return Response.json({ ok: true }); // ack malformed to avoid retry storms
  }

  const startedAt = Date.now();
  const eventRecord = await recordInboundEvent({ source: "telegram_webhook", rawBody: raw });
  if (!eventRecord.duplicate) {
    void finishInboundEvent(eventRecord.eventRecordId, { processingStatus: "processed", startedAt, responseStatus: 200 });
  }

  // Ack immediately, process in the background — same reasoning as every
  // other webhook: don't make the provider wait on our AI call.
  void processUpdate(channel.tenantId, update).catch(() => {});
  return Response.json({ ok: true });
}

const handledIds = new Set<string>();
function firstTimeSeeing(id: number | undefined): boolean {
  if (id == null) return true;
  const key = String(id);
  if (handledIds.has(key)) return false;
  handledIds.add(key);
  if (handledIds.size > 1000) handledIds.delete(handledIds.values().next().value as string);
  return true;
}

async function processUpdate(tenantId: string, update: TelegramUpdate): Promise<void> {
  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (chatId == null || !text) return; // non-text update (photo, sticker, etc.) — v1 doesn't handle it
  if (!firstTimeSeeing(update.message?.message_id)) return; // skip re-deliveries

  await handleInbound({
    tenantId,
    fromNumber: String(chatId), // Telegram's chat id doubles as the "sender identity" InboundInput expects
    channelType: "telegram",
    text,
  });
}
