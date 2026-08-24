import { withTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeBill } from "@/lib/billing";
import { Card, Stat, PageHeader, Badge } from "@/components/ui";
import { PayButton } from "./pay-button";
import { AutoRenewForm } from "./auto-renew-form";
import { UpgradePlanButton } from "./upgrade-plan-button";

const kes = (n: number) => `KES ${n.toLocaleString("en-US")}`;
const STATUS_TONE: Record<string, "green" | "amber" | "rose" | "neutral" | "accent"> = {
  active: "green", trial: "accent", renewal_due: "amber", payment_pending: "amber", grace_period: "amber", suspended: "rose", cancelled: "neutral",
};

export default async function BillingPage() {
  return withTenantUser(async (user) => {
    const tenantId = user.tenantId!;
    const [bill, payments, sub, allPlans] = await Promise.all([
      computeBill(tenantId),
      db.payment.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 12 }),
      db.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      db.plan.findMany({ where: { active: true }, orderBy: { sort: "asc" } }),
    ]);
    // Downgrades are read from Plan.sort, not priceMonthly — see
    // upgradeSubscriptionPlanAction's comment (Enterprise prices at 0, same
    // as Free, but is the top tier).
    const upgradeOptions = sub ? allPlans.filter((p) => p.sort > sub.plan.sort) : [];
    const pendingPlan = sub?.pendingPlanId ? allPlans.find((p) => p.id === sub.pendingPlanId) : null;

    return (
      <div>
        <PageHeader title="Billing" subtitle={`Plan + usage for ${bill.periodLabel} — one simple monthly bill.`} />

        {sub && (
          <Card className="mb-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted">Subscription status:</span>
                <Badge tone={STATUS_TONE[sub.status] ?? "neutral"} dot>{sub.status.replace(/_/g, " ")}</Badge>
                {sub.status !== "cancelled" && (
                  <span className="text-muted">Renews {sub.renewsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
                )}
                {sub.status === "grace_period" && sub.graceEndsAt && (
                  <span className="text-rose">— service pauses automatically on {sub.graceEndsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} unless paid</span>
                )}
              </div>
            </div>
            {pendingPlan && (
              <p className="mt-2 text-xs text-amber">
                Switching to {pendingPlan.name} on {sub!.renewsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} — this cycle finishes on your current plan.
              </p>
            )}
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="This month" value={kes(bill.total)} sub={`${bill.planName} plan + usage`} />
          <Stat label="Conversations" value={bill.lines[0]?.qty.toLocaleString("en-US") ?? "0"} sub="Across all connected channels" />
          <Stat label="Plan fee" value={kes(bill.planFee)} sub="per month" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card className="p-5">
            <h2 className="mb-3 font-display font-semibold">Current invoice</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="py-1.5">Item</th><th className="py-1.5 text-right">Qty</th>
                  <th className="py-1.5 text-right">Unit</th><th className="py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line-soft">
                  <td className="py-2">{bill.planName} plan</td><td className="py-2 text-right">1</td>
                  <td className="py-2 text-right">{kes(bill.planFee)}</td><td className="py-2 text-right">{kes(bill.planFee)}</td>
                </tr>
                {bill.lines.map((l) => (
                  <tr key={l.label} className="border-t border-line-soft">
                    <td className="py-2">{l.label}</td><td className="py-2 text-right">{l.qty}</td>
                    <td className="py-2 text-right">{kes(l.unit)}</td><td className="py-2 text-right">{kes(l.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <td className="py-2.5 font-semibold" colSpan={3}>Total due</td>
                  <td className="py-2.5 text-right font-semibold">{kes(bill.total)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-4">
              <PayButton amount={bill.total} />
              <p className="mt-2 text-xs text-faint">Real M-Pesa STK push (Safaricom Daraja). Enter your number and approve the prompt on your phone. Without Daraja keys set, it records in demo mode.</p>
            </div>
            <div className="mt-5 border-t border-line-soft pt-4">
              <h3 className="mb-2 text-sm font-display font-semibold">Auto-renewal</h3>
              <AutoRenewForm billingPhone={sub?.billingPhone ?? null} autoRenew={sub?.autoRenew ?? false} />
              <p className="mt-2 text-xs text-faint">When set, P2Less automatically sends an M-Pesa request to this number on your renewal date — no need to remember to pay manually.</p>
            </div>
          </Card>

          <Card className="p-5">
            {upgradeOptions.length > 0 ? (
              <>
                <h2 className="mb-1 font-display font-semibold">Upgrade your plan</h2>
                <p className="mb-3 text-xs text-muted">Takes effect immediately — this month's bill switches to the new rate right away. Want to downgrade instead? Contact us.</p>
                <div className="space-y-2">
                  {upgradeOptions.map((p) => (
                    <UpgradePlanButton key={p.id} planId={p.id} planName={p.name} priceMonthly={p.priceMonthly} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2 className="mb-2 font-display font-semibold">What&apos;s included</h2>
                <ul className="space-y-2 text-sm text-muted">
                  <li>One simple bill covering your plan and usage — nothing else to set up or manage separately.</li>
                  <li>Fully managed, end to end — no other accounts, vendors, or invoices for you to track.</li>
                  <li>Payments are confirmed automatically — no manual reconciliation on your side.</li>
                </ul>
              </>
            )}
          </Card>
        </div>

        <Card className="mt-4 p-5">
          <h2 className="mb-3 font-display font-semibold">Payment history</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-xs text-faint">
                <th className="py-1.5">Reference</th><th className="py-1.5">Date</th><th className="py-1.5">Method</th>
                <th className="py-1.5 text-right">Amount</th><th className="py-1.5">Status</th>
              </tr></thead>
              <tbody>
                {payments.length === 0 && <tr><td colSpan={5} className="py-4 text-muted">No payments yet.</td></tr>}
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-line-soft">
                    <td className="py-2 font-mono text-xs">{p.reference}</td>
                    <td className="py-2 text-xs text-muted">{p.createdAt.toLocaleDateString()}</td>
                    <td className="py-2 text-xs">{p.method}</td>
                    <td className="py-2 text-right">{p.currency} {p.amount.toLocaleString("en-US")}</td>
                    <td className="py-2"><Badge tone={p.status === "paid" ? "green" : p.status === "failed" ? "rose" : "amber"}>{p.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  });
}
