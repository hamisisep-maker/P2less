"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changeTenantPlanAction } from "@/lib/admin-actions";

type PlanOption = { id: string; name: string; sort: number; priceMonthly: number };

/** Admin-side plan assignment — handles both directions. Upgrades apply
 *  immediately; downgrades are scheduled for the next renewal (the server
 *  action decides which, via Plan.sort — this component just reflects it
 *  back so an admin knows what they're about to do before confirming). */
export function PlanChangePicker({ tenantId, currentPlanId, currentSort, plans, canManage }: {
  tenantId: string;
  currentPlanId: string;
  currentSort: number;
  plans: PlanOption[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState(currentPlanId);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  if (!canManage) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2">
        Change plan
      </button>
    );
  }

  const selected = plans.find((p) => p.id === planId);
  const isUpgrade = selected ? selected.sort > currentSort : null;

  return (
    <div className="rounded-xl border border-line bg-surface p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="rounded-md border border-line bg-surface-2 px-2 py-1 outline-none focus:border-accent"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name} — KES {p.priceMonthly.toLocaleString("en-US")}/mo{p.id === currentPlanId ? " (current)" : ""}</option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required)…"
          className="w-48 rounded-md border border-line bg-surface-2 px-2 py-1 outline-none focus:border-accent"
        />
        <button
          disabled={pending || planId === currentPlanId || reason.trim().length < 3}
          onClick={() =>
            startTransition(async () => {
              const res = await changeTenantPlanAction(tenantId, planId, reason.trim());
              if ("error" in res && res.error) { toast.error(res.error); return; }
              if ("ok" in res) toast.success(`Switched to ${res.planName} — ${res.effective === "immediate" ? "effective now" : "effective at next renewal"}`);
              setOpen(false);
              setReason("");
            })
          }
          className="rounded-md bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-2.5 py-1 font-semibold text-white disabled:opacity-40"
        >
          {pending ? "…" : "Confirm"}
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setPlanId(currentPlanId); setReason(""); }} className="rounded-md border border-line px-2 py-1 text-muted">
          Cancel
        </button>
      </div>
      {selected && planId !== currentPlanId && (
        <p className="mt-1.5 text-faint">
          {isUpgrade ? "Upgrade — applies immediately, this month's bill switches to the new rate." : "Downgrade — scheduled for the next renewal, this cycle finishes on the current plan."}
        </p>
      )}
    </div>
  );
}
