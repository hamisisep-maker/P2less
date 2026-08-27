import { Card } from "@/components/ui";
import type { UsageSummary } from "@/lib/prepaid-billing";
import { UpgradeModal } from "./billing/upgrade-modal";

const kes = (n: number) => `KES ${n.toLocaleString("en-US")}`;

function Bar({ pct, tone }: { pct: number; tone: "ok" | "low" | "exhausted" }) {
  const fill = tone === "exhausted" ? "bg-rose" : tone === "low" ? "bg-amber" : "bg-accent";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full rounded-full transition-all duration-500 ${fill}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
    </div>
  );
}

type NextPlan = { id: string; name: string; priceMonthly: number };

/** Real, always-visible "where do we stand right now" card, 2026-08-27 —
 *  direct request: whichever way someone is testing/paying (a free trial's
 *  message/AI-request allowance, or a real plan's prepaid KES balance), show
 *  it depleting as it's actually used, not just a silent block once it runs
 *  out. Reuses UpgradeModal for the "top up" flow (same real M-Pesa/card
 *  payment path already proven on the Billing page) — auto-opens it, with an
 *  attention-grabbing reason banner, the moment this tenant is genuinely
 *  exhausted, rather than requiring someone to notice the notification bell.
 *  Renders nothing for Enterprise (postpaidUsage — no ceiling to show).
 *
 *  Deliberately takes already-resolved data as props rather than querying
 *  the DB itself — a real bug found live, 2026-08-27: this used to be an
 *  `async` Server Component doing its own `db.subscription.findUnique()`
 *  call, which threw `TenantContextMissingError`. The tenant context
 *  `withTenantUser()` establishes in the parent page does NOT survive across
 *  a JSX child boundary into a separately-rendered async component's own
 *  query — the same documented AsyncLocalStorage propagation gap behind this
 *  whole codebase's `with*` wrapper pattern (see db.ts / auth.ts). Every
 *  other card on this page already follows the "fetch in the page's own
 *  withTenantUser callback, pass plain props down" shape for this exact
 *  reason — this now matches it. */
export function UsageBalanceCard({
  summary, nextPlan, upgradePlans, pricePerMessageKes,
}: {
  summary: UsageSummary; nextPlan: NextPlan | null; upgradePlans: NextPlan[]; pricePerMessageKes: number;
}) {
  if (summary.kind === "unlimited") return null;

  const exhaustedReason = summary.exhausted && nextPlan
    ? summary.kind === "trial"
      ? { title: "Free trial used up", detail: "Your free trial allowance for this month is used up, so your assistant has stopped replying to new messages.", planOptions: upgradePlans, pricePerMessageKes }
      : { title: "Balance used up", detail: "Your prepaid balance has run out, so your assistant has stopped replying to new messages.", planOptions: upgradePlans, pricePerMessageKes }
    : null;

  return (
    <Card className="mb-4 p-5">
      {summary.kind === "trial" ? (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display font-semibold">Free trial balance</h2>
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-ink">Trial</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {([["Messages this month", summary.messages], ["AI understanding this month", summary.aiRequests]] as const).map(([label, u]) => {
              const limit = u.limit ?? 0;
              const pct = limit > 0 ? (u.used / limit) * 100 : 0;
              const tone = !u.ok ? "exhausted" : pct >= 80 ? "low" : "ok";
              return (
                <div key={label}>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="text-muted">{label}</span>
                    <span className={"font-medium " + (tone === "exhausted" ? "text-rose" : tone === "low" ? "text-amber" : "text-ink")}>
                      {u.used.toLocaleString("en-US")} / {limit.toLocaleString("en-US")}
                    </span>
                  </div>
                  <Bar pct={pct} tone={tone} />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display font-semibold">Prepaid balance</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {([["Messages", summary.messageBalanceKes, summary.messageLow], ["AI understanding", summary.aiBalanceKes, summary.aiLow]] as const).map(([label, balance, low]) => {
              const tone = balance <= 0 ? "exhausted" : low ? "low" : "ok";
              return (
                <div key={label} className="flex items-center justify-between rounded-xl border border-line-soft px-3.5 py-2.5">
                  <span className="text-sm text-muted">{label}</span>
                  <span className={"font-display text-lg font-bold " + (tone === "exhausted" ? "text-rose" : tone === "low" ? "text-amber" : "text-ink")}>
                    {kes(balance)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {summary.exhausted && nextPlan && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-rose/30 bg-rose-soft px-4 py-3">
          <p className="text-sm text-rose">
            {summary.kind === "trial" ? "Your free trial is used up — new messages aren't being answered." : "Your balance is used up — new messages aren't being answered."}
          </p>
          <UpgradeModal planId={nextPlan.id} planName={nextPlan.name} priceMonthly={nextPlan.priceMonthly} exhausted={exhaustedReason} />
        </div>
      )}
      {!summary.exhausted && nextPlan && (summary.kind === "trial" ? false : summary.messageLow || summary.aiLow) && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber/30 bg-amber-soft px-4 py-3">
          <p className="text-sm text-amber">Running low — top up before it runs out to avoid an interruption.</p>
          <UpgradeModal planId={nextPlan.id} planName={nextPlan.name} priceMonthly={nextPlan.priceMonthly} />
        </div>
      )}
    </Card>
  );
}
