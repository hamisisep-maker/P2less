"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { activateEmailChannelAction } from "@/lib/actions";

type State = { error?: string; ok?: true; address?: string } | null;

export function ConnectEmailButton() {
  const [state, action, pending] = useActionState<State, FormData>(activateEmailChannelAction, null);

  useEffect(() => {
    if (state?.ok) toast.success(state.address ? `Activated ${state.address}` : "Email activated");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {pending ? "Activating…" : "Activate email address"}
      </button>
      {state?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
    </form>
  );
}
