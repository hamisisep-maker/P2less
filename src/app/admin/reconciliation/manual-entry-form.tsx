"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { createUnmatchedTransactionAction } from "@/lib/reconciliation-actions";

type State = { error?: string; ok?: boolean } | null;

export function ManualEntryForm() {
  const [state, action, pending] = useActionState<State, FormData>(createUnmatchedTransactionAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) { toast.success("Recorded — visible below to match or ignore"); formRef.current?.reset(); }
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-6">
      <label className="block sm:col-span-1">
        <span className="text-xs font-medium text-muted">Channel</span>
        <select name="channelKey" required defaultValue="bank_transfer" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          <option value="bank_transfer">Bank transfer</option>
          <option value="mpesa_paybill">PayBill</option>
          <option value="mpesa_till">Till</option>
        </select>
      </label>
      <label className="block sm:col-span-1">
        <span className="text-xs font-medium text-muted">Reference / statement code</span>
        <input name="providerRef" required placeholder="e.g. FT23A1B2C3" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block sm:col-span-1">
        <span className="text-xs font-medium text-muted">Amount (KES)</span>
        <input name="amount" type="number" min="1" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block sm:col-span-1">
        <span className="text-xs font-medium text-muted">Date</span>
        <input name="occurredAt" type="date" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block sm:col-span-1">
        <span className="text-xs font-medium text-muted">Sender name</span>
        <input name="senderName" placeholder="e.g. XYZ Ltd" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <div className="flex items-end sm:col-span-1">
        <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
          {pending ? "Saving…" : "Add"}
        </button>
      </div>
    </form>
  );
}
