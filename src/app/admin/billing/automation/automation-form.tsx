"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateBillingAutomationAction } from "@/lib/admin-actions";

type State = { error?: string; ok?: boolean } | null;

export function AutomationForm({ initial }: { initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<State, FormData>(updateBillingAutomationAction, null);
  useEffect(() => {
    if (state?.ok) toast.success("Automation settings updated");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="text-xs font-medium text-muted">Grace period (days)</span>
        <input name="billing_grace_period_days" type="number" min="0" defaultValue={initial.billing_grace_period_days} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        <span className="mt-0.5 block text-[11px] text-faint">Days a tenant keeps service after retries are exhausted, before auto-suspend.</span>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Max renewal-charge retries</span>
        <input name="billing_max_retries" type="number" min="1" defaultValue={initial.billing_max_retries} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Retry interval (hours)</span>
        <input name="billing_retry_interval_hours" type="number" min="1" defaultValue={initial.billing_retry_interval_hours} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Reconciliation window (hours)</span>
        <input name="billing_reconciliation_window_hours" type="number" step="0.5" min="0.1" defaultValue={initial.billing_reconciliation_window_hours} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        <span className="mt-0.5 block text-[11px] text-faint">How long to wait for a payment webhook before flagging "unknown — investigate" instead of assuming failure.</span>
      </label>
      <label className="block sm:col-span-2">
        <span className="text-xs font-medium text-muted">Default reminder days (comma-separated, informational)</span>
        <input name="billing_reminder_days" defaultValue={initial.billing_reminder_days} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="billing_auto_renew_charge_enabled" defaultChecked={initial.billing_auto_renew_charge_enabled === "1"} className="rounded" />
        Automatically charge tenants for renewal (via their on-file M-Pesa number)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="billing_auto_suspend_enabled" defaultChecked={initial.billing_auto_suspend_enabled === "1"} className="rounded" />
        Automatically suspend service when grace period ends unpaid
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
          {pending ? "Saving…" : "Save automation settings"}
        </button>
      </div>
    </form>
  );
}
