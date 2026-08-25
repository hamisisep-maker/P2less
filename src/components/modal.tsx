"use client";

import { useEffect } from "react";

// Real modal overlay — 2026-08-25. Before this, the whole app relied on
// window.confirm() + a toast for every destructive/consequential action
// (see src/components/confirm-action-button.tsx, toggle-active-button.tsx).
// Built first for the invoice payment flow (dashboard/billing/upgrade-modal.tsx)
// where a toast is genuinely not enough for a real-money decision — reusable
// from here for any future consequential-action confirmation.
export function Modal({ open, onClose, title, children, closeOnBackdrop = true }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; closeOnBackdrop?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card-hover)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="modal-title" className="font-display text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
