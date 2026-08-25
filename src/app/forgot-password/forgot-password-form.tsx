"use client";

import { useActionState } from "react";
import { requestPasswordResetAction } from "@/lib/actions";

type State = { ok?: boolean; message?: string; error?: string } | null;

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<State, FormData>(requestPasswordResetAction, null);

  if (state?.ok) {
    return (
      <div className="mt-6 rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink">{state.message}</div>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="text-sm font-medium">Email</label>
        <input name="email" type="email" required autoFocus className="mt-1 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent" />
      </div>
      {state?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
