"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";

// Shared QR-pairing UI for the unofficial WhatsApp transport — used both by
// "Connect via alternative" (a brand new number) and by the per-number
// switch control (an existing number moving from Meta to the alternative).
// Polls the tenant-scoped baileys-qr route every 2.5s, same lightweight
// polling shape as api/payments/status's consumer.
export function BaileysQrModal({ open, onClose, numberId }: { open: boolean; onClose: () => void; numberId: string | null }) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !numberId) return;
    setQr(null);
    setConnected(false);
    setError(null);

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/channels/whatsapp/baileys-qr?numberId=${numberId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { connected: boolean; qr?: string | null; phoneNumber?: string };
        if (cancelled) return;
        if (data.connected) {
          setConnected(true);
          router.refresh();
        } else if (data.qr) {
          setQr(data.qr);
        }
      } catch {
        if (!cancelled) setError("Couldn't reach the pairing service.");
      }
    };

    void poll();
    const interval = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [open, numberId, router]);

  return (
    <Modal open={open} onClose={onClose} title="Scan to connect">
      {connected ? (
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-ink">
          Connected. This number is now paired via the alternative transport.
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Open WhatsApp on the phone you want to connect &rarr; Settings &rarr; Linked Devices &rarr; Link a Device, then scan this code.
          </p>
          <div className="flex justify-center rounded-xl border border-line bg-surface-2 p-4">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="WhatsApp pairing QR code" width={280} height={280} />
            ) : (
              <div className="flex h-[280px] w-[280px] items-center justify-center text-xs text-faint">Waiting for a code&hellip;</div>
            )}
          </div>
          <p className="text-xs text-faint">The code refreshes automatically if it expires. Keep this open until it connects.</p>
          {error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
