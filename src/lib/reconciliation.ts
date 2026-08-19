import "server-only";
import { db } from "./db";
import { getSettingNumber } from "./platform-settings";
import { classifyOutcome } from "./classify-outcome";
import { syncReconciliationFlag } from "./payment-channels";

// ─────────────────────────────────────────────────────────────────────────────
// Extends the "unknown, not failed" safety net billing-lifecycle.ts already
// applies to subscription renewals to EVERY purpose — order and wallet-topup
// payments that time out with no callback previously just sat at "pending"
// forever with no flag at all. Runs as its own job (not folded into
// runBillingCycle) since it's a general payments concern, not billing-lifecycle-specific.
// ─────────────────────────────────────────────────────────────────────────────

export async function runReconciliationSweep(): Promise<{ flaggedUnknown: number }> {
  const windowHours = await getSettingNumber("billing_reconciliation_window_hours");
  const windowMs = windowHours * 3_600_000;
  const now = new Date();

  const stalePending = await db.payment.findMany({
    where: { status: "pending", createdAt: { lt: new Date(now.getTime() - windowMs) } },
  });

  let flaggedUnknown = 0;
  for (const payment of stalePending) {
    const ageMs = now.getTime() - payment.createdAt.getTime();
    const outcome = classifyOutcome({ definitiveResponseReceived: false, ageMs, reconciliationWindowMs: windowMs });
    if (outcome.kind !== "unknown") continue;
    await db.payment.update({ where: { id: payment.id }, data: { status: "unknown" } });
    if (payment.purpose === "subscription") await syncReconciliationFlag(payment.tenantId);
    flaggedUnknown++;
  }

  return { flaggedUnknown };
}
