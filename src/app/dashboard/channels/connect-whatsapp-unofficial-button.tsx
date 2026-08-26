"use client";

import { useActionState, useEffect, useState } from "react";
import { startWhatsAppUnofficialConnectAction } from "@/lib/actions";
import { BaileysQrModal } from "./baileys-qr-modal";

export function ConnectWhatsAppUnofficialButton() {
  const [state, action, pending] = useActionState(startWhatsAppUnofficialConnectAction, null as { ok?: true; numberId?: string; error?: string } | null);
  const [openNumberId, setOpenNumberId] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok && state.numberId) setOpenNumberId(state.numberId);
  }, [state]);

  return (
    <>
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          {pending ? "Starting…" : "Connect via alternative"}
        </button>
        {state?.error && <div className="mt-2 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
      </form>
      <BaileysQrModal open={!!openNumberId} onClose={() => setOpenNumberId(null)} numberId={openNumberId} />
    </>
  );
}
