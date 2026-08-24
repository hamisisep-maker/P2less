"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { upgradeSubscriptionPlanAction } from "@/lib/actions";

const kes = (n: number) => `KES ${n.toLocaleString("en-US")}`;
type State = { ok?: boolean; planName?: string; error?: string } | null;

// Upgrades only — downgrades are deliberately not self-service (see the
// action's own comment for why). Applies immediately on confirm: the
// current month's bill switches to the new plan's rate right away, no
// partial-month credit, same explicit rule the server enforces.
export function UpgradePlanButton({ planId, planName, priceMonthly }: { planId: string; planName: string; priceMonthly: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(upgradeSubscriptionPlanAction, null as State);

  if (state?.ok) {
    return <p className="text-sm text-green">✓ Upgraded to {state.planName}.</p>;
  }

  return (
    <form
      action={action}
      onSubmit={() => setTimeout(() => router.refresh(), 300)}
      className="flex items-center justify-between gap-3 rounded-xl border border-line-soft px-3.5 py-2.5"
    >
      <div>
        <div className="text-sm font-medium">{planName}</div>
        <div className="text-xs text-muted">{priceMonthly > 0 ? `${kes(priceMonthly)}/mo + usage` : "Contact us for pricing"}</div>
      </div>
      <input type="hidden" name="planId" value={planId} />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3.5 py-1.5 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60"
      >
        {pending ? "Upgrading…" : "Upgrade"}
      </button>
      {state?.error && <p className="text-xs text-rose">{state.error}</p>}
    </form>
  );
}
