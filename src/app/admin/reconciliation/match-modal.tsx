"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Modal } from "@/components/dashboard-ui";
import { matchUnmatchedTransactionAction } from "@/lib/reconciliation-actions";

type State = { error?: string; ok?: boolean } | null;

function MatchForm({ txId, tenants, onDone }: { txId: string; tenants: { id: string; name: string }[]; onDone: () => void }) {
  const bound = async (_prev: State, formData: FormData) => {
    const tenantId = String(formData.get("tenantId") ?? "");
    const reason = String(formData.get("reason") ?? "");
    return matchUnmatchedTransactionAction(txId, tenantId, reason);
  };
  const [state, action, pending] = useActionState<State, FormData>(bound, null);

  useEffect(() => {
    if (state?.ok) { toast.success("Matched — payment recorded and subscription updated"); onDone(); }
    if (state?.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-muted">Tenant</span>
        <select name="tenantId" required defaultValue="" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          <option value="" disabled>Choose a tenant…</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Reason (required, audit trail)</span>
        <input name="reason" required placeholder="e.g. Confirmed with tenant, transaction ID matches their receipt" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
        {pending ? "Matching…" : "Match & confirm payment"}
      </button>
    </form>
  );
}

export function MatchModal({ txId, providerRef, tenants }: { txId: string; providerRef: string; tenants: { id: string; name: string }[] }) {
  return (
    <Modal
      title={`Match transaction ${providerRef}`}
      description="Creates a real payment and updates the tenant's subscription — this is a financial action, not a label change."
      trigger={
        <button className="flex items-center gap-1 rounded-lg border border-green/30 px-2.5 py-1.5 text-xs font-medium text-green hover:bg-green-soft">
          <Link2 size={12} /> Match
        </button>
      }
    >
      <MatchForm txId={txId} tenants={tenants} onDone={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))} />
    </Modal>
  );
}
