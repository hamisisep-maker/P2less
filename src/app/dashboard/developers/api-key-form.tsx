"use client";

import { useActionState } from "react";
import { createApiKeyAction } from "@/lib/actions";

type State = { ok?: boolean; key?: string; error?: string } | null;

export function ApiKeyForm() {
  const [state, action, pending] = useActionState(createApiKeyAction, null as State);
  return (
    <div>
      {state?.ok && state.key && (
        <div className="mb-3 rounded-xl border border-green/30 bg-green-soft p-3">
          <div className="text-xs font-medium text-green">Copy this key now — it won&apos;t be shown again.</div>
          <code className="mt-1 block break-all font-mono text-sm text-ink">{state.key}</code>
        </div>
      )}
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input name="name" placeholder="Key name (e.g. Production)" className="min-w-[180px] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0">
          {pending ? "Creating…" : "Create API key"}
        </button>
      </form>
      {state?.error && <p className="mt-2 text-sm text-rose">{state.error}</p>}
    </div>
  );
}
