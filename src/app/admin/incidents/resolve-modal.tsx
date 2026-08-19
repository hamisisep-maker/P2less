"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/dashboard-ui";
import { resolveIncidentAction } from "@/lib/incident-actions";

type State = { error?: string; ok?: boolean } | null;

function ResolveForm({ incidentId, onDone }: { incidentId: string; onDone: () => void }) {
  const bound = async (_prev: State, formData: FormData) =>
    resolveIncidentAction(incidentId, String(formData.get("cause") ?? ""), String(formData.get("resolutionNote") ?? ""));
  const [state, action, pending] = useActionState<State, FormData>(bound, null);

  useEffect(() => {
    if (state?.ok) { toast.success("Incident resolved"); onDone(); }
    if (state?.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-muted">Cause (required)</span>
        <input name="cause" required placeholder="e.g. Provider connectivity issue" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Resolution (required)</span>
        <input name="resolutionNote" required placeholder="e.g. Connection recovered, verified 3 successful requests" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
        {pending ? "Resolving…" : "Mark resolved"}
      </button>
    </form>
  );
}

export function ResolveModal({ incidentId }: { incidentId: string }) {
  return (
    <Modal title="Resolve incident" description="Record what actually happened — this becomes part of the audit trail." trigger={
      <button className="flex items-center gap-1 rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-2.5 py-1.5 text-xs font-semibold text-white">
        <CheckCircle2 size={12} /> Resolve
      </button>
    }>
      <ResolveForm incidentId={incidentId} onDone={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))} />
    </Modal>
  );
}
