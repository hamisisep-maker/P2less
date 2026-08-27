import "server-only";
import { db } from "./db";
import { getSettingNumber } from "./platform-settings";
import { checkLimit } from "./usage";
import { sendSms, smsEnabled } from "./sms";
import { sendEmail } from "./notification-channels";
import { resolveTenantRecipientEmail } from "./notifications";

type LimitStatus = { ok: boolean; limit: number | null; used: number };
export type UsageSummary =
  | { kind: "trial"; messages: LimitStatus; aiRequests: LimitStatus; trialExpired: boolean; trialEndsAt: Date | null; exhausted: boolean }
  | { kind: "balance"; messageBalanceKes: number; aiBalanceKes: number; messageLow: boolean; aiLow: boolean; exhausted: boolean }
  | { kind: "unlimited" };

function isTrialExpired(sub: Pick<GatedSub, "trialEndsAt">): boolean {
  return !!sub.trialEndsAt && sub.trialEndsAt.getTime() <= Date.now();
}

/** One real, unified answer to "where does this tenant stand right now" —
 *  built for the dashboard's always-visible usage card and the
 *  balance-exhausted modal, 2026-08-27 (direct request: show the free-trial
 *  balance depleting as it's used, alert + redirect to payment once it runs
 *  out). Deliberately reuses the two gating mechanisms that already decide
 *  real access (checkLimit() for trial, the prepaid KES balance for real
 *  plans) rather than inventing a third notion of "usage" — whatever this
 *  reports is exactly what's actually blocking or not blocking traffic. A
 *  trial keeps reporting `kind: "trial"` even once its 7 days are up (rather
 *  than switching to `kind: "balance"`, which the real gate below falls
 *  through to) — the DISPLAY reason should say "your trial ended," not show
 *  a confusing "KES 0 balance" a trial user was never shown a balance for. */
export async function getUsageSummary(tenantId: string): Promise<UsageSummary> {
  const sub = await loadGatedSub(tenantId);
  if (!sub) return { kind: "unlimited" };
  if (sub.plan.postpaidUsage) return { kind: "unlimited" };
  if (sub.status === "trial") {
    const [messages, aiRequests] = await Promise.all([checkLimit(tenantId, "message_in"), checkLimit(tenantId, "ai_request")]);
    const trialExpired = isTrialExpired(sub);
    return { kind: "trial", messages, aiRequests, trialExpired, trialEndsAt: sub.trialEndsAt, exhausted: !messages.ok || !aiRequests.ok || trialExpired };
  }
  const [msgThreshold, aiThreshold] = await Promise.all([
    getSettingNumber("low_balance_threshold_messages_kes"),
    getSettingNumber("low_balance_threshold_ai_kes"),
  ]);
  return {
    kind: "balance",
    messageBalanceKes: sub.messageBalanceKes,
    aiBalanceKes: sub.aiBalanceKes,
    messageLow: sub.messageBalanceKes <= msgThreshold,
    aiLow: sub.aiBalanceKes <= aiThreshold,
    exhausted: sub.messageBalanceKes <= 0 || sub.aiBalanceKes <= 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepaid billing, 2026-08-25 — the gate that makes the whole redesign real:
// checked BEFORE the actual external cost (the real WhatsApp/channel send,
// the real AI provider call), never after. Every plan except Enterprise
// (Plan.postpaidUsage) draws from two separate real-KES balances instead of
// being billed post-hoc at renewal — see Subscription.messageBalanceKes/
// aiBalanceKes's own schema comment for the full reasoning.
//
// A trial-status subscription is exempt from THIS gate only while its real
// 7-day trialEndsAt hasn't passed yet (2026-08-27 — previously exempt
// forever, a genuinely perpetual free tier despite being named/modeled as a
// trial; see Subscription.trialEndsAt's schema comment). While still within
// its 7 days, it's checked against the existing count-limit mechanism
// (checkLimit(), Plan.limits on the internal "free" plan) further down each
// caller's own existing pre-check, exactly as before. Once the 7 days pass,
// it deliberately falls straight through to the SAME real-balance check
// every paid plan uses below — a never-paying trial tenant's balance is
// always 0, so this naturally blocks with zero extra branching, the same
// "we're unable to respond right now" message a paid tenant out of balance
// already gets.
// ─────────────────────────────────────────────────────────────────────────────

type GatedSub = { id: string; tenantId: string; status: string; trialEndsAt: Date | null; messageBalanceKes: number; aiBalanceKes: number; plan: { postpaidUsage: boolean } };

function isGateExempt(sub: GatedSub): boolean {
  if (sub.plan.postpaidUsage) return true;
  if (sub.status === "trial") return !isTrialExpired(sub);
  return false;
}

async function loadGatedSub(tenantId: string): Promise<GatedSub | null> {
  return db.subscription.findUnique({
    where: { tenantId },
    select: { id: true, tenantId: true, status: true, trialEndsAt: true, messageBalanceKes: true, aiBalanceKes: true, plan: { select: { postpaidUsage: true } } },
  });
}

/** Resolves the real per-message price for this send, given which transport
 *  the WhatsAppNumber is on — the one place the Baileys discount actually
 *  applies, 2026-08-26. Non-WhatsApp channels and Meta-transport WhatsApp
 *  both pay the normal price_conversation_kes rate, unaffected. A Baileys
 *  ("unofficial") send costs 0 until an admin explicitly turns on
 *  baileys_billing_active (still meter()-ed regardless, see usage.ts) — once
 *  on, it's price_conversation_kes * baileys_discount_multiplier, never the
 *  full rate. AI-understanding pricing (price_ai_kes) is never touched by
 *  this — see hasAiBudget/debitAiBalance below, unchanged. */
async function resolveMessagePrice(transport?: string | null): Promise<number> {
  const price = await getSettingNumber("price_conversation_kes");
  if (transport !== "unofficial") return price;
  const active = await getSettingNumber("baileys_billing_active");
  if (!active) return 0;
  const multiplier = await getSettingNumber("baileys_discount_multiplier");
  return price * multiplier;
}

export async function hasMessageBudget(tenantId: string, transport?: string | null): Promise<boolean> {
  const sub = await loadGatedSub(tenantId);
  if (!sub) return false;
  if (isGateExempt(sub)) return true;
  const price = await resolveMessagePrice(transport);
  return sub.messageBalanceKes >= price;
}

export async function hasAiBudget(tenantId: string): Promise<boolean> {
  const sub = await loadGatedSub(tenantId);
  if (!sub) return false;
  if (isGateExempt(sub)) return true;
  const price = await getSettingNumber("price_ai_kes");
  return sub.aiBalanceKes >= price;
}

/** Real, honest AI-only fallback check for the trial-allowance case — trial
 *  tenants aren't balance-gated (see isGateExempt), but they DO still need
 *  the existing checkLimit() count check before an AI call, same as before
 *  this redesign. Kept here (not duplicated at each call site) so the two
 *  separate gating mechanisms — balance for real plans, count for trial —
 *  are both reachable from one place. */
export async function hasAiBudgetOrTrialAllowance(tenantId: string): Promise<boolean> {
  const sub = await loadGatedSub(tenantId);
  if (!sub) return false;
  if (sub.plan.postpaidUsage) return true;
  if (sub.status === "trial" && !isTrialExpired(sub)) return (await checkLimit(tenantId, "ai_request")).ok;
  const price = await getSettingNumber("price_ai_kes");
  return sub.aiBalanceKes >= price;
}

/** Debits real KES from the message balance — a no-op for Enterprise/trial
 *  subscriptions (their usage is tracked by the existing UsageEvent metering
 *  instead, untouched). Called AFTER a message was actually processed, never
 *  before — the GATE (hasMessageBudget) is what runs before. */
export async function debitMessageBalance(tenantId: string, transport?: string | null): Promise<void> {
  const sub = await loadGatedSub(tenantId);
  if (!sub || isGateExempt(sub)) return;
  const price = await resolveMessagePrice(transport);
  if (price <= 0) return; // Baileys billing not active yet — meter()-ed, but genuinely free, nothing to decrement
  await db.subscription.update({ where: { tenantId }, data: { messageBalanceKes: { decrement: price } } });
  checkAndNotifyLowBalance(tenantId).catch(() => {});
}

/** Same shape as debitMessageBalance, for the AI balance. */
export async function debitAiBalance(tenantId: string): Promise<void> {
  const sub = await loadGatedSub(tenantId);
  if (!sub || isGateExempt(sub)) return;
  const price = await getSettingNumber("price_ai_kes");
  await db.subscription.update({ where: { tenantId }, data: { aiBalanceKes: { decrement: price } } });
  checkAndNotifyLowBalance(tenantId).catch(() => {});
}

/** Low-balance notification, 2026-08-25 — fired from BOTH debit functions
 *  (never awaited by either — a notification send must never slow down or
 *  risk a real customer reply) so a balance getting low from EITHER kind of
 *  usage is always caught, and so a message crossing low while AI is already
 *  low (or vice versa) still only ever sends ONE combined notification, not
 *  two separate ones close together.
 *
 *  Per-balance messageLowBalanceNotifiedAt/aiLowBalanceNotifiedAt each track
 *  their OWN crossing independently: cleared as soon as this check next runs
 *  (i.e. the next real message/AI call) after a top-up brings that balance
 *  back above its threshold — there's no top-up flow yet to hook a clear into
 *  directly (that's the next stage), so it's re-evaluated here, on the only
 *  event that currently touches these balances at all — so a later real
 *  crossing notifies
 *  again), and only set once per crossing (so it doesn't fire on every
 *  single message while sitting below the line). A send only fires when at
 *  least one of the two newly crosses in THIS call — but if the other
 *  balance is ALSO currently low (already notified earlier and still not
 *  topped up), it's mentioned in the same message rather than causing its
 *  own separate send. */
async function checkAndNotifyLowBalance(tenantId: string): Promise<void> {
  const sub = await db.subscription.findUnique({
    where: { tenantId },
    select: {
      messageBalanceKes: true, aiBalanceKes: true,
      messageLowBalanceNotifiedAt: true, aiLowBalanceNotifiedAt: true,
      billingPhone: true,
    },
  });
  if (!sub) return;
  const [msgThreshold, aiThreshold] = await Promise.all([
    getSettingNumber("low_balance_threshold_messages_kes"),
    getSettingNumber("low_balance_threshold_ai_kes"),
  ]);
  const messageLow = sub.messageBalanceKes <= msgThreshold;
  const aiLow = sub.aiBalanceKes <= aiThreshold;
  const newMessageCrossing = messageLow && !sub.messageLowBalanceNotifiedAt;
  const newAiCrossing = aiLow && !sub.aiLowBalanceNotifiedAt;

  // Always keep the two flags true to CURRENT state — clears the moment a
  // top-up brings a balance back above its threshold, regardless of whether
  // a notification fires this call, so the next real crossing notifies again.
  const data: { messageLowBalanceNotifiedAt?: Date | null; aiLowBalanceNotifiedAt?: Date | null } = {};
  if (messageLow !== !!sub.messageLowBalanceNotifiedAt) data.messageLowBalanceNotifiedAt = messageLow ? new Date() : null;
  if (aiLow !== !!sub.aiLowBalanceNotifiedAt) data.aiLowBalanceNotifiedAt = aiLow ? new Date() : null;
  if (Object.keys(data).length > 0) await db.subscription.update({ where: { tenantId }, data });

  if (!newMessageCrossing && !newAiCrossing) return;

  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const lines: string[] = [];
  if (messageLow) lines.push(`Message balance: KES ${sub.messageBalanceKes.toLocaleString("en-US")} remaining (threshold KES ${msgThreshold}).`);
  if (aiLow) lines.push(`AI understanding balance: KES ${sub.aiBalanceKes.toLocaleString("en-US")} remaining (threshold KES ${aiThreshold}).`);
  const body = `${tenant?.name ?? "Your organization"}'s P2Less balance is running low.\n\n${lines.join("\n")}\n\nTop up from your dashboard's Billing page to avoid an interruption in service.`;

  if (sub.billingPhone && smsEnabled()) {
    const sent = await sendSms(sub.billingPhone, body).catch((e) => ({ ok: false as const, error: String(e) }));
    if (!sent.ok) console.error(`[low-balance] SMS send failed for tenant ${tenantId}: ${sent.error}`);
  }
  const email = await resolveTenantRecipientEmail(tenantId);
  if (email) {
    const sent = await sendEmail({ to: email, subject: `${tenant?.name ?? "P2Less"} — balance running low`, text: body }).catch((e) => ({ ok: false as const, error: String(e) }));
    if (!sent.ok) console.error(`[low-balance] Email send failed for tenant ${tenantId}: ${sent.error}`);
  } else {
    console.error(`[low-balance] No recipient email on file for tenant ${tenantId}.`);
  }
}

/** For the dashboard notification bell (src/app/dashboard/layout.tsx) — real
 *  current low-balance state, or null for a gate-exempt subscription
 *  (Enterprise/trial), which never shows this warning at all. */
export async function getLowBalanceStatus(tenantId: string): Promise<{ messageLow: boolean; aiLow: boolean; messageBalanceKes: number; aiBalanceKes: number } | null> {
  const sub = await loadGatedSub(tenantId);
  if (!sub || isGateExempt(sub)) return null;
  const [msgThreshold, aiThreshold] = await Promise.all([
    getSettingNumber("low_balance_threshold_messages_kes"),
    getSettingNumber("low_balance_threshold_ai_kes"),
  ]);
  return {
    messageLow: sub.messageBalanceKes <= msgThreshold,
    aiLow: sub.aiBalanceKes <= aiThreshold,
    messageBalanceKes: sub.messageBalanceKes,
    aiBalanceKes: sub.aiBalanceKes,
  };
}

/** One-time boot-time migration (called from scripts/prod-start.mjs on EVERY
 *  boot, same pattern as the WhatsApp-number-routing reconciliation there) —
 *  every subscription that existed before this prepaid-balance gate shipped
 *  has messageBalanceKes/aiBalanceKes at their schema default of 0, which
 *  would otherwise silently block 100% of its real traffic the instant the
 *  gate went live (confirmed live 2026-08-25: the full regression suite went
 *  from 73/73 to 31/73 passing, every failure showing the balance-exhausted
 *  fallback, until this ran). Gated on balanceMigratedAt (not "balance is
 *  0") so a tenant who legitimately runs a real balance down through normal
 *  usage is never re-granted a free top-up on a later boot — this only ever
 *  fires once per subscription, ever. */
export async function migrateSubscriptionBalances(): Promise<number> {
  const [messagesGrant, aiGrant, pending] = await Promise.all([
    getSettingNumber("migration_grant_messages_kes"),
    getSettingNumber("migration_grant_ai_kes"),
    db.subscription.findMany({
      where: { balanceMigratedAt: null, status: { not: "trial" }, plan: { postpaidUsage: false } },
      select: { id: true },
    }),
  ]);
  for (const s of pending) {
    await db.subscription.update({
      where: { id: s.id },
      data: { messageBalanceKes: messagesGrant, aiBalanceKes: aiGrant, balanceMigratedAt: new Date() },
    });
  }
  return pending.length;
}
