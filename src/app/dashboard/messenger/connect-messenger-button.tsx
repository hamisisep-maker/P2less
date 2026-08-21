"use client";

import { useActionState } from "react";
import { startMessengerConnectAction } from "@/lib/actions";

export function ConnectMessengerButton() {
  const [state, action, pending] = useActionState(startMessengerConnectAction, null as { error?: string } | null);
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {pending ? "Opening Meta…" : "Connect a Facebook Page"}
      </button>
      {state?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
    </form>
  );
}
