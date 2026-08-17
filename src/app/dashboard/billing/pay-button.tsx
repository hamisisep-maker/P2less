"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startPaymentAction } from "@/lib/actions";

const kes = (n: number) => `KES ${n.toLocaleString("en-US")}`;
type State = { ok?: boolean; ref?: string; checkoutId?: string; mock?: boolean; message?: string; error?: string } | null;

export function PayButton({ amount }: { amount: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(startPaymentAction, null as State);
  const [poll, setPoll] = useState<"idle" | "waiting" | "paid" | "failed">("idle");

  // After a real STK push, poll for the callback result.
  useEffect(() => {
    if (state?.ok && state.checkoutId && state.ref) {
      setPoll("waiting");
      const ref = state.ref;
      const started = Date.now();
      const t = setInterval(async () => {
        try {
          const r = await fetch(`/api/payments/status?ref=${encodeURIComponent(ref)}`);
          const d = (await r.json()) as { status?: string };
          if (d.status === "paid") { setPoll("paid"); clearInterval(t); router.refresh(); }
          else if (d.status === "failed") { setPoll("failed"); clearInterval(t); }
        } catch { /* keep polling */ }
        if (Date.now() - started > 90_000) { clearInterval(t); setPoll("idle"); }
      }, 3000);
      return () => clearInterval(t);
    }
    if (state?.ok && state.mock) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="phone"
          required
          placeholder="M-Pesa no. e.g. 0712345678"
          className="min-w-[190px] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <input type="hidden" name="amount" value={amount} />
        <button
          type="submit"
          disabled={pending || amount <= 0 || poll === "waiting"}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-60"
        >
          {pending ? "Sending…" : poll === "waiting" ? "Waiting for PIN…" : `Pay ${kes(amount)} via M-Pesa`}
        </button>
      </div>

      {state?.error && <p className="mt-2 text-sm text-rose">{state.error}</p>}
      {state?.ok && state.mock && <p className="mt-2 text-sm text-green">✓ {state.message}</p>}
      {poll === "waiting" && (
        <p className="mt-2 text-sm text-amber">📲 STK push sent — enter your M-Pesa PIN on your phone to approve (ref {state?.ref}).</p>
      )}
      {poll === "paid" && <p className="mt-2 text-sm text-green">✓ Payment received. Thank you!</p>}
      {poll === "failed" && <p className="mt-2 text-sm text-rose">Payment was cancelled or failed. You can try again.</p>}
    </form>
  );
}
