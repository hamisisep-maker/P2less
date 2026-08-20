"use client";

import { useActionState } from "react";
import { createWidgetKeyAction } from "@/lib/actions";

type State = { ok?: boolean; key?: string; error?: string } | null;

export function WidgetKeyForm() {
  const [state, action, pending] = useActionState(createWidgetKeyAction, null as State);
  return (
    <div>
      {state?.ok && state.key && (
        <div className="mb-3 rounded-xl border border-green/30 bg-green-soft p-3">
          <div className="text-xs font-medium text-green">Widget key created — copy the snippet below into your website.</div>
          <code className="mt-1 block break-all font-mono text-sm text-ink">{state.key}</code>
        </div>
      )}
      <form action={action} className="flex flex-col gap-2">
        <label className="text-xs font-medium text-muted">Allowed website domain(s) — one per line. Leave blank while testing (any domain allowed, logged).</label>
        <textarea
          name="origins"
          placeholder={"example.com\nwww.example.com"}
          rows={2}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {pending ? "Creating…" : "Create widget key"}
        </button>
      </form>
      {state?.error && <p className="mt-2 text-sm text-rose">{state.error}</p>}
    </div>
  );
}
