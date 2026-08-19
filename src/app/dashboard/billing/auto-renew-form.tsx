"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateAutoRenewAction } from "@/lib/actions";

type State = { error?: string; ok?: boolean } | null;

export function AutoRenewForm({ billingPhone, autoRenew }: { billingPhone: string | null; autoRenew: boolean }) {
  const [state, action, pending] = useActionState<State, FormData>(updateAutoRenewAction, null);
  useEffect(() => {
    if (state?.ok) toast.success("Auto-renewal settings updated");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-xs font-medium text-muted">M-Pesa number for automatic renewal</span>
        <input name="billingPhone" defaultValue={billingPhone ?? ""} placeholder="e.g. 0712345678" className="mt-1 w-56 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="flex items-center gap-2 pb-2.5 text-sm">
        <input type="checkbox" name="autoRenew" defaultChecked={autoRenew} className="rounded" />
        Charge this number automatically when my plan renews
      </label>
      <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
