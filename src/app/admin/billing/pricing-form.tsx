"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { updatePricingSettingsAction, resetPricingDefaultsAction } from "@/lib/admin-actions";

type State = { error?: string; ok?: boolean } | null;

const FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "price_conversation_kes", label: "Charge per conversation", hint: "What the org pays P2Less, per WhatsApp conversation" },
  { key: "price_ai_kes", label: "Charge per AI request", hint: "What the org pays P2Less, per AI understanding call" },
  { key: "price_document_kes", label: "Charge per document", hint: "What the org pays P2Less, per generated PDF" },
  { key: "cost_conversation_kes", label: "Meta cost per conversation", hint: "Your estimate of Meta's WhatsApp conversation fee — Meta has no public real-time billing API, so keep this current from your Meta invoice" },
  { key: "cost_document_kes", label: "Document generation cost", hint: "Estimated compute cost per generated PDF" },
];

export function PricingForm({ initial }: { initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<State, FormData>(updatePricingSettingsAction, null);

  useEffect(() => {
    if (state?.ok) toast.success("Pricing updated", { description: "New rates apply to every bill computed from now on." });
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="text-xs font-medium text-muted">{f.label}</span>
          <div className="mt-1 flex items-center rounded-xl border border-line bg-surface px-3 focus-within:border-accent">
            <span className="text-xs text-faint">KES</span>
            <input name={f.key} type="number" step="0.01" min="0" defaultValue={initial[f.key]} className="w-full bg-transparent px-2 py-2 text-sm outline-none" />
          </div>
          <span className="mt-0.5 block text-[11px] text-faint">{f.hint}</span>
        </label>
      ))}
      <div className="flex items-end gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0">
          {pending ? "Saving…" : "Save pricing"}
        </button>
        <button
          type="button"
          onClick={() => { resetPricingDefaultsAction().then(() => { toast.success("Reset to defaults"); }); }}
          className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm text-muted hover:bg-surface-2"
        >
          <RotateCcw size={13} /> Reset defaults
        </button>
      </div>
    </form>
  );
}
