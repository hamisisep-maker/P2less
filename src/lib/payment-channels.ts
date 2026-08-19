import "server-only";
import { db } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// Real gating + the "Subscription.reconciliationNeeded is now derived"
// bridge. assertChannelEnabled() is what makes "disabled integration
// actually stops the functionality" literally true for payments — called
// from every Payment-creating call site BEFORE either the mock or real path,
// so disabling a channel stops both.
// ─────────────────────────────────────────────────────────────────────────────

export type ChannelCheck = { ok: true } | { ok: false; error: string };

export async function assertChannelEnabled(channelKey: string): Promise<ChannelCheck> {
  const channel = await db.paymentChannel.findUnique({ where: { key: channelKey }, include: { integration: true } });
  if (!channel) return { ok: true }; // channel not yet modeled — don't block something that was never gated before
  if (!channel.integration.enabled) return { ok: false, error: "This payment method is currently disabled. Please try again later or contact support." };
  if (!channel.implemented) return { ok: false, error: "This payment method is not available yet." };
  return { ok: true };
}

/** Subscription.reconciliationNeeded is now a DERIVED read-cache, not an
 *  independently-written flag — its truth comes from whether this tenant has
 *  any subscription-purpose Payment sitting at status="unknown". Call this
 *  after any transition that could change that (a payment resolves, a new
 *  one goes stale, a manual match happens) so the ~6 existing read sites
 *  (the automation page, runBillingCycle's own gate, clearReconciliationAction)
 *  keep working unchanged, now fed by the more general Payment-level mechanism. */
export async function syncReconciliationFlag(tenantId: string): Promise<void> {
  const stillUnknown = await db.payment.count({ where: { tenantId, purpose: "subscription", status: "unknown" } });
  await db.subscription.update({ where: { tenantId }, data: { reconciliationNeeded: stillUnknown > 0 } }).catch(() => {});
}

/** Records real channel-level rollup stats used by the health/reconciliation
 *  views — called after a payment on that channel resolves one way or the
 *  other. Best-effort; never blocks the caller. */
export async function recordChannelOutcome(channelKey: string, ok: boolean): Promise<void> {
  await db.paymentChannel.update({
    where: { key: channelKey },
    data: ok ? { lastSuccessAt: new Date() } : { lastFailureAt: new Date() },
  }).catch(() => {});
}

export async function recordChannelCallback(channelKey: string): Promise<void> {
  await db.paymentChannel.update({ where: { key: channelKey }, data: { lastCallbackAt: new Date() } }).catch(() => {});
}
