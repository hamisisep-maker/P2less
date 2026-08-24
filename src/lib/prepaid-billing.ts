import "server-only";
import { db } from "./db";
import { getSettingNumber } from "./platform-settings";
import { checkLimit } from "./usage";

// ─────────────────────────────────────────────────────────────────────────────
// Prepaid billing, 2026-08-25 — the gate that makes the whole redesign real:
// checked BEFORE the actual external cost (the real WhatsApp/channel send,
// the real AI provider call), never after. Every plan except Enterprise
// (Plan.postpaidUsage) draws from two separate real-KES balances instead of
// being billed post-hoc at renewal — see Subscription.messageBalanceKes/
// aiBalanceKes's own schema comment for the full reasoning.
//
// Trial-status subscriptions are NOT gated here at all — they're still
// checked against the existing count-limit mechanism (checkLimit(), reusing
// Plan.limits on the internal "free" plan, untouched) further down each
// caller's own existing pre-check. This module only ever answers "does a
// REAL, active, non-Enterprise plan have budget," and only ever debits for
// that same category — trial and Enterprise usage keep being tracked purely
// via the existing UsageEvent metering, exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

type GatedSub = { id: string; tenantId: string; status: string; messageBalanceKes: number; aiBalanceKes: number; plan: { postpaidUsage: boolean } };

async function loadGatedSub(tenantId: string): Promise<GatedSub | null> {
  return db.subscription.findUnique({
    where: { tenantId },
    select: { id: true, tenantId: true, status: true, messageBalanceKes: true, aiBalanceKes: true, plan: { select: { postpaidUsage: true } } },
  });
}

/** true = this tenant is NOT subject to the prepaid balance gate at all
 *  (Enterprise, or still on trial — trial has its own count-limit gate,
 *  checked by the caller via checkLimit() same as it always has been). */
function isGateExempt(sub: GatedSub): boolean {
  return sub.plan.postpaidUsage || sub.status === "trial";
}

export async function hasMessageBudget(tenantId: string): Promise<boolean> {
  const sub = await loadGatedSub(tenantId);
  if (!sub) return false;
  if (isGateExempt(sub)) return true;
  const price = await getSettingNumber("price_conversation_kes");
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
  if (sub.status === "trial") return (await checkLimit(tenantId, "ai_request")).ok;
  const price = await getSettingNumber("price_ai_kes");
  return sub.aiBalanceKes >= price;
}

/** Debits real KES from the message balance — a no-op for Enterprise/trial
 *  subscriptions (their usage is tracked by the existing UsageEvent metering
 *  instead, untouched). Called AFTER a message was actually processed, never
 *  before — the GATE (hasMessageBudget) is what runs before. */
export async function debitMessageBalance(tenantId: string): Promise<void> {
  const sub = await loadGatedSub(tenantId);
  if (!sub || isGateExempt(sub)) return;
  const price = await getSettingNumber("price_conversation_kes");
  await db.subscription.update({ where: { tenantId }, data: { messageBalanceKes: { decrement: price } } });
}

/** Same shape as debitMessageBalance, for the AI balance. */
export async function debitAiBalance(tenantId: string): Promise<void> {
  const sub = await loadGatedSub(tenantId);
  if (!sub || isGateExempt(sub)) return;
  const price = await getSettingNumber("price_ai_kes");
  await db.subscription.update({ where: { tenantId }, data: { aiBalanceKes: { decrement: price } } });
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
