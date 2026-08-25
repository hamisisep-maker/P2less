// Invoice-centric paid-upgrade flow, 2026-08-25 — pure proration math, no DB,
// no "use server" (kept separate from invoicing.ts specifically so it stays
// directly unit-testable and never accidentally becomes a client-callable
// RPC endpoint, which every export of a "use server" file automatically is).

// Kenya (EAT, UTC+3) has no DST — a fixed offset is always correct, no
// timezone library needed. All day-boundary math uses this consistently
// (currentPeriodStartedAt, renewsAt, and "now") so a proration computed near
// midnight never lands on the wrong side of a day boundary from raw
// elapsed-ms division being timezone/time-of-day sensitive.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
export function eatDayIndex(d: Date): number {
  return Math.floor((d.getTime() + EAT_OFFSET_MS) / 86_400_000);
}

export type Proration = {
  daysInCycle: number;
  usedDays: number;
  remainingDays: number;
  remainingValueKes: number;
};

/** The actual cycle length is NOT "days in the calendar month containing
 *  today." Renewal is a rolling one-month anchor (nextRenewalDate(),
 *  billing-lifecycle.ts: `setMonth(+1)`), so a cycle can span two different
 *  calendar months (e.g. 20 Jan -> 20 Feb = 31 days, the correct real
 *  length of that specific span). daysInCycle is therefore the real gap
 *  between currentPeriodStartedAt and renewsAt, which naturally comes out
 *  to 28-31 depending on which real month(s) it crosses. */
export function computeProration(fromPlanPriceKes: number, currentPeriodStartedAt: Date, renewsAt: Date, now: Date): Proration {
  const startIdx = eatDayIndex(currentPeriodStartedAt);
  const endIdx = eatDayIndex(renewsAt);
  const nowIdx = eatDayIndex(now);
  const daysInCycle = Math.max(1, endIdx - startIdx); // defensive floor — never divide by zero
  const usedDaysRaw = nowIdx - startIdx;
  const usedDays = Math.min(Math.max(usedDaysRaw, 0), daysInCycle);
  const remainingDays = daysInCycle - usedDays;
  const remainingValueKes = Math.floor((fromPlanPriceKes / daysInCycle) * remainingDays);
  return { daysInCycle, usedDays, remainingDays, remainingValueKes };
}
