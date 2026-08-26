"use client";

import { useActionState, useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import { switchWhatsAppTransportAction, disconnectWhatsAppNumberAction, reconnectWhatsAppNumberAction, forgetAndRepairWhatsAppNumberAction } from "@/lib/actions";
import { BaileysQrModal } from "./baileys-qr-modal";

// The per-number "trace which one is connected on Meta and which is not"
// control — a transport badge plus a switch button that opens a real
// breakdown-before-you-commit Modal (never window.confirm(), same reasoning
// as UpgradeModal), because switching transport is a genuine disconnect-and-
// repair operation on WhatsApp's side, not a flag flip — the copy below says
// so plainly rather than implying instant reversibility that doesn't exist.
// Plus a standalone Disconnect/Reconnect control, 2026-08-26 (direct request:
// "what if I want to disconnect but I don't want to switch") — sets/clears
// WhatsAppNumber.status, the field conversation.ts's handleInbound already
// treats as the real routing-eligibility gate.
export function WhatsAppTransportSwitch({
  numberId,
  phoneNumber,
  transport,
  status,
  unofficialTransportEnabled = true,
}: {
  numberId: string;
  phoneNumber: string | null;
  transport: string;
  status: string;
  // Platform kill switch, 2026-08-26 — an admin disabling the whatsapp_baileys
  // Integration only blocks switching TO the alternative; a number already
  // ON it can always switch back to Meta regardless, so leaving isn't gated
  // shut behind the same switch that stops new/renewed use of it.
  unofficialTransportEnabled?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [state, action, pending] = useActionState(switchWhatsAppTransportAction, null as { ok?: true; error?: string } | null);
  const target: "meta" | "unofficial" = transport === "unofficial" ? "meta" : "unofficial";
  const switchBlocked = target === "unofficial" && !unofficialTransportEnabled;

  useEffect(() => {
    if (state?.ok) {
      setConfirmOpen(false);
      if (target === "unofficial") setQrOpen(true);
    }
  }, [state, target]);

  const numberLabel = phoneNumber ?? "this number";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!switchBlocked && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="text-xs font-medium text-accent underline underline-offset-2 hover:text-accent-ink"
          >
            Switch to {target === "meta" ? "Meta" : "alternative"}
          </button>
        )}
        <span className="text-line">·</span>
        <DisconnectControl numberId={numberId} phoneNumber={phoneNumber} status={status} transport={transport} />
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

/** Standalone "make this number stop answering, without moving it to the
 *  other transport" control. Disconnecting always gets the same real
 *  breakdown-before-you-commit confirmation as switching (this genuinely
 *  stops real customer messages from being answered) — reconnecting doesn't,
 *  since it's the safe/reversible direction and the number's own status
 *  badge already makes "currently disconnected" obvious at a glance. */
function DisconnectControl({ numberId, phoneNumber, status, transport }: { numberId: string; phoneNumber: string | null; status: string; transport: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [forgetPairingPhone, setForgetPairingPhone] = useState("");
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(disconnectWhatsAppNumberAction, null as { ok?: true; error?: string } | null);
  const [reconnectState, reconnectAction, reconnectPending] = useActionState(reconnectWhatsAppNumberAction, null as { ok?: true; error?: string } | null);
  const [forgetState, forgetAction, forgetPending] = useActionState(forgetAndRepairWhatsAppNumberAction, null as { ok?: true; numberId?: string; error?: string } | null);
  const numberLabel = phoneNumber ?? "this number";

  useEffect(() => {
    if (disconnectState?.ok) setConfirmOpen(false);
  }, [disconnectState]);

  useEffect(() => {
    if (forgetState?.ok) {
      setForgetOpen(false);
      setQrOpen(true);
    }
  }, [forgetState]);

  if (status !== "active") {
    return (
      <>
        <form action={reconnectAction}>
          <input type="hidden" name="numberId" value={numberId} />
          <button type="submit" disabled={reconnectPending} className="text-xs font-medium text-accent underline underline-offset-2 hover:text-accent-ink disabled:opacity-60">
            {reconnectPending ? "Reconnecting…" : "Reconnect"}
          </button>
        </form>
        {reconnectState?.error && <span className="text-xs text-rose">{reconnectState.error}</span>}
        {/* Real recovery path for a dead persisted session, 2026-08-26 — a
            WhatsApp-side close that leaves auth credentials permanently
            unable to resume looks identical to any other disconnect from
            here, so plain "Reconnect" just retries the same dead handshake.
            Deliberately separate and de-emphasized (not the default action)
            since it forces a real re-pairing (new QR/code), not a quiet
            resume — only reach for it once Reconnect has already been tried. */}
        {transport === "unofficial" && (
          <>
            <span className="text-line">·</span>
            <button type="button" onClick={() => setForgetOpen(true)} className="text-xs font-medium text-muted underline underline-offset-2 hover:text-ink">
              Reconnect not working? Forget &amp; pair again
            </button>
          </>
        )}

        <Modal open={forgetOpen} onClose={() => setForgetOpen(false)} title="Forget this session and pair again">
          <div className="space-y-4">
            <div className="rounded-lg border border-amber/30 bg-amber-soft px-4 py-3 text-sm text-amber">
              Use this only if plain &quot;Reconnect&quot; keeps failing. It will:
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Erase {numberLabel}&apos;s saved connection — it can no longer resume automatically.</li>
                <li>Require scanning a fresh QR code (or entering a new pairing code) on the phone, right now.</li>
                <li>All other connected numbers are unaffected.</li>
              </ul>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-muted">Camera not working? Enter your WhatsApp number to get a typed pairing code instead</span>
              <input
                type="text"
                value={forgetPairingPhone}
                onChange={(e) => setForgetPairingPhone(e.target.value)}
                placeholder="e.g. 254712345678 — leave blank to scan a QR code"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
              />
            </label>
            <form action={forgetAction} className="flex justify-end gap-2">
              <input type="hidden" name="numberId" value={numberId} />
              <input type="hidden" name="pairingPhoneNumber" value={forgetPairingPhone} />
              <button type="button" onClick={() => setForgetOpen(false)} className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-surface-2">
                Cancel
              </button>
              <button
                type="submit"
                disabled={forgetPending}
                className="rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {forgetPending ? "Clearing…" : "Forget & pair again"}
              </button>
            </form>
            {forgetState?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{forgetState.error}</div>}
          </div>
        </Modal>

        <BaileysQrModal open={qrOpen} onClose={() => setQrOpen(false)} numberId={qrOpen ? numberId : null} />
      </>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setConfirmOpen(true)} className="text-xs font-medium text-rose underline underline-offset-2 hover:opacity-80">
        Disconnect
      </button>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Disconnect this number">
        <div className="space-y-4">
          <div className="rounded-lg border border-rose/30 bg-rose-soft px-4 py-3 text-sm text-rose">
            Disconnecting {numberLabel} will:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Stop it from answering any real customer messages right now.</li>
              <li>Stay this way until you reconnect it — it does not switch to the other transport, it just goes quiet.</li>
              <li>All other connected numbers are unaffected.</li>
            </ul>
          </div>
          <form action={disconnectAction} className="flex justify-end gap-2">
            <input type="hidden" name="numberId" value={numberId} />
            <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-surface-2">
              Cancel
            </button>
            <button type="submit" disabled={disconnectPending} className="rounded-lg bg-rose px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {disconnectPending ? "Disconnecting…" : "Confirm disconnect"}
            </button>
          </form>
          {disconnectState?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{disconnectState.error}</div>}
        </div>
      </Modal>
    </>
  );
}
