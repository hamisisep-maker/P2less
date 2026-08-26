"use client";

import { useActionState, useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { Modal } from "@/components/modal";
import { switchWhatsAppTransportAction } from "@/lib/actions";
import { BaileysQrModal } from "./baileys-qr-modal";

// The per-number "trace which one is connected on Meta and which is not"
// control — a transport badge plus a switch button that opens a real
// breakdown-before-you-commit Modal (never window.confirm(), same reasoning
// as UpgradeModal), because switching transport is a genuine disconnect-and-
// repair operation on WhatsApp's side, not a flag flip — the copy below says
// so plainly rather than implying instant reversibility that doesn't exist.
export function WhatsAppTransportSwitch({ numberId, phoneNumber, transport }: { numberId: string; phoneNumber: string | null; transport: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [state, action, pending] = useActionState(switchWhatsAppTransportAction, null as { ok?: true; error?: string } | null);
  const target: "meta" | "unofficial" = transport === "unofficial" ? "meta" : "unofficial";

  useEffect(() => {
    if (state?.ok) {
      setConfirmOpen(false);
      if (target === "unofficial") setQrOpen(true);
    }
  }, [state, target]);

  const numberLabel = phoneNumber ?? "this number";

  return (
    <>
      <div className="flex items-center gap-2">
        <Badge tone={transport === "unofficial" ? "amber" : "indigo"}>{transport === "unofficial" ? "Alternative" : "Meta"}</Badge>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="text-xs font-medium text-accent underline underline-offset-2 hover:text-accent-ink"
        >
          Switch to {target === "meta" ? "Meta" : "alternative"}
        </button>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Switch connection method">
        <div className="space-y-4">
          <div className="rounded-lg border border-amber/30 bg-amber-soft px-4 py-3 text-sm text-amber">
            Switching {numberLabel} from {target === "meta" ? "the alternative transport" : "Meta's WhatsApp Business API"} to{" "}
            {target === "meta" ? "Meta's WhatsApp Business API" : "the alternative transport"} will:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {target === "unofficial" ? (
                <>
                  <li>Disconnect this number from Meta's Cloud API right now.</li>
                  <li>Require scanning a QR code with the WhatsApp app on that phone to reconnect.</li>
                  <li>Interrupt message delivery on this number until pairing completes.</li>
                </>
              ) : (
                <>
                  <li>Disconnect this number from the alternative transport right now.</li>
                  <li>Require reconnecting via the &quot;Connect via Meta&quot; button afterward.</li>
                  <li>Interrupt message delivery on this number until Meta reconnection completes.</li>
                </>
              )}
              <li>All other connected numbers are unaffected.</li>
            </ul>
          </div>
          <form action={action} className="flex justify-end gap-2">
            <input type="hidden" name="numberId" value={numberId} />
            <input type="hidden" name="to" value={target} />
            <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-surface-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Switching…" : "Confirm switch"}
            </button>
          </form>
          {state?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
        </div>
      </Modal>

      <BaileysQrModal open={qrOpen} onClose={() => setQrOpen(false)} numberId={qrOpen ? numberId : null} />
    </>
  );
}
