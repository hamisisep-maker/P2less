"use client";

import { useActionState, useEffect, useState } from "react";
import { startWhatsAppUnofficialConnectAction } from "@/lib/actions";
import { BaileysQrModal } from "./baileys-qr-modal";

export function ConnectWhatsAppUnofficialButton() {
  const [state, action, pending] = useActionState(startWhatsAppUnofficialConnectAction, null as { ok?: true; numberId?: string; error?: string } | null);
  const [openNumberId, setOpenNumberId] = useState<string | null>(null);
  const [pairingPhoneNumber, setPairingPhoneNumber] = useState("");

  useEffect(() => {
    if (state?.ok && state.numberId) setOpenNumberId(state.numberId);
  }, [state]);

  return (
    <>
      <form action={action} className="space-y-1.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          {pending ? "Starting…" : "Connect via alternative"}
        </button>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            name="pairingPhoneNumber"
            value={pairingPhoneNumber}
            onChange={(e) => setPairingPhoneNumber(e.target.value)}
            placeholder="Camera not working? Enter your WhatsApp number"
            className="w-64 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
          />
        </div>
        <p className="text-[11px] text-faint">Leave blank to scan a QR code, or enter your WhatsApp number (with country code) to get a typed pairing code instead.</p>
        {state?.error && <div className="mt-2 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
      </form>
      <BaileysQrModal open={!!openNumberId} onClose={() => setOpenNumberId(null)} numberId={openNumberId} />
    </>
  );
}
