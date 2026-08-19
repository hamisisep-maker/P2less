"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Pencil, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui";
import { Modal } from "@/components/dashboard-ui";
import { updatePlanAction } from "@/lib/admin-actions";
import type { PlanMargin } from "@/lib/billing";

type State = { error?: string; ok?: boolean } | null;

export type PlanForCalc = {
  id: string; name: string; priceMonthly: number; active: boolean;
  limits: { users?: number; messagesPerMonth?: number; connectors?: number; aiRequestsPerMonth?: number; documentsPerMonth?: number };
  margin: PlanMargin;
};

function EditForm({ plan, onDone }: { plan: PlanForCalc; onDone: () => void }) {
  const [state, action, pending] = useActionState<State, FormData>(updatePlanAction, null);
  useEffect(() => {
    if (state?.ok) { toast.success(`${plan.name} updated`); onDone(); }
    if (state?.error) toast.error(state.error);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="planId" value={plan.id} />
      <label className="block">
        <span className="text-xs font-medium text-muted">Monthly price (KES)</span>
        <input name="priceMonthly" type="number" min="0" defaultValue={plan.priceMonthly} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-muted">Messages / mo</span>
          <input name="messagesPerMonth" type="number" min="0" defaultValue={plan.limits.messagesPerMonth ?? 0} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">AI requests / mo</span>
          <input name="aiRequestsPerMonth" type="number" min="0" defaultValue={plan.limits.aiRequestsPerMonth ?? 0} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Documents / mo</span>
          <input name="documentsPerMonth" type="number" min="0" defaultValue={plan.limits.documentsPerMonth ?? 0} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Connectors</span>
          <input name="connectors" type="number" min="0" defaultValue={plan.limits.connectors ?? 0} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted">Users</span>
        <input name="users" type="number" min="0" defaultValue={plan.limits.users ?? 0} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={plan.active} className="rounded" /> Active (visible for new signups)
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Reason for this change (required, audit trail)</span>
        <input name="reason" required placeholder="e.g. Q3 pricing adjustment" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      {!plan.margin.unlimited && plan.margin.marginPct < 0 && (
        <p className="rounded-xl bg-rose-soft p-2.5 text-xs text-rose">
          At current pricing, a tenant maxing out this plan's limits would cost you more than they pay. Suggested minimum price: <b>KES {plan.margin.suggestedMinPrice.toLocaleString("en-US")}/mo</b>.
        </p>
      )}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
        {pending ? "Saving…" : "Save plan"}
      </button>
    </form>
  );
}

export function PlanCard({ plan }: { plan: PlanForCalc }) {
  const m = plan.margin;
  const healthy = m.unlimited || m.marginPct >= 20;
  const warning = !m.unlimited && m.marginPct >= 0 && m.marginPct < 20;
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between">
        <div className="font-display font-semibold">{plan.name}</div>
        <Badge tone={plan.active ? "green" : "neutral"} dot>{plan.active ? "active" : "hidden"}</Badge>
      </div>
      <div className="mt-1 font-display text-lg font-bold">{plan.priceMonthly === 0 ? "Free" : `KES ${plan.priceMonthly.toLocaleString("en-US")}`}<span className="text-xs font-normal text-faint">{plan.priceMonthly === 0 ? "" : "/mo"}</span></div>

      <div className="mt-3 rounded-xl bg-surface-2 p-3 text-xs">
        {m.unlimited ? (
          <p className="text-muted">Unlimited plan — no usage ceiling to calculate a worst-case margin from. Price this as a custom/negotiated deal.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-muted">If maxed out this month:</span>
              {healthy ? <TrendingUp size={14} className="text-green" /> : <TrendingDown size={14} className="text-rose" />}
            </div>
            <div className="mt-1 flex items-center justify-between"><span className="text-muted">They'd pay</span><b>KES {m.revenueAtMax.toLocaleString("en-US")}</b></div>
            <div className="flex items-center justify-between"><span className="text-muted">You'd pay out</span><b>KES {Math.round(m.costAtMax).toLocaleString("en-US")}</b></div>
            <div className="mt-1.5 border-t border-line pt-1.5">
              <Badge tone={healthy ? "green" : warning ? "amber" : "rose"}>
                {m.marginPct >= 0 ? `+${m.marginPct.toFixed(0)}% margin` : `${m.marginPct.toFixed(0)}% margin — LOSES money`}
              </Badge>
            </div>
          </>
        )}
      </div>

      <Modal
        title={`Edit ${plan.name}`}
        description="Changes apply immediately to new bills."
        trigger={<button className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-xs font-medium text-muted hover:bg-surface-2"><Pencil size={12} /> Edit price & limits</button>}
      >
        <PlanEditWrapper plan={plan} />
      </Modal>
    </div>
  );
}

// Radix Dialog keeps its content mounted even when closed (for the exit
// animation), so the form needs its own trigger to actually close the modal
// on success — done via a synthetic Escape keypress rather than fighting
// Dialog's controlled-state API for one simple case.
function PlanEditWrapper({ plan }: { plan: PlanForCalc }) {
  return <EditForm plan={plan} onDone={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))} />;
}
