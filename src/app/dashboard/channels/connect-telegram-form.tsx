"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { connectTelegramBotAction } from "@/lib/actions";

type State = { error?: string; ok?: true; username?: string } | null;

export function ConnectTelegramForm() {
  const [state, action, pending] = useActionState<State, FormData>(connectTelegramBotAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) { toast.success(state.username ? `Connected @${state.username}` : "Bot connected"); formRef.current?.reset(); }
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-start gap-2">
      <input
        name="botToken"
        type="text"
        required
        placeholder="Bot token from @BotFather (e.g. 123456789:AAH...)"
        className="min-w-[280px] flex-1 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {pending ? "Connecting…" : "Connect bot"}
      </button>
      {state?.error && <div className="w-full rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
    </form>
  );
}
