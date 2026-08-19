"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { addModelPricingAction } from "@/lib/admin-actions";

type State = { error?: string; ok?: boolean } | null;

const PROVIDERS = ["google", "groq", "cerebras", "openrouter", "anthropic", "openai", "xai"];

export function AddPricingForm() {
  const [state, action, pending] = useActionState<State, FormData>(addModelPricingAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) { toast.success("Pricing recorded", { description: "Applies to every AI call from now on — past calls keep the price that was in effect when they happened." }); formRef.current?.reset(); }
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-5">
      <label className="block">
        <span className="text-xs font-medium text-muted">Provider</span>
        <select name="provider" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Model name</span>
        <input name="model" required placeholder="e.g. openai/gpt-oss-120b" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Input $/1M tokens</span>
        <input name="inputPerMillionUsd" type="number" step="0.01" min="0" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Output $/1M tokens</span>
        <input name="outputPerMillionUsd" type="number" step="0.01" min="0" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <div className="flex items-end">
        <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
          {pending ? "Saving…" : "Set price"}
        </button>
      </div>
    </form>
  );
}
