"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

type ActionResult = { ok?: boolean; error?: string } | void;

/** A button that expands into a required-reason inline form before firing an
 *  elevated/dangerous admin action — the UI counterpart to every action that
 *  calls assertAdminPermission(...) with a `reason` argument in
 *  admin-actions.ts. The reason is never optional here: Confirm stays
 *  disabled until it's long enough. */
export function ReasonAction({
  label, className, confirmLabel = "Confirm", placeholder = "Reason (required, goes in the audit trail)…",
  onConfirm, successMessage, minLength = 3, inputClassName,
}: {
  label: ReactNode;
  className?: string;
  inputClassName?: string;
  confirmLabel?: string;
  placeholder?: string;
  onConfirm: (reason: string) => Promise<ActionResult>;
  successMessage?: string | ((reason: string) => string);
  minLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface p-1.5">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        className={inputClassName ?? "w-56 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs outline-none focus:border-accent"}
      />
      <button
        type="button"
        disabled={pending || reason.trim().length < minLength}
        onClick={() =>
          startTransition(async () => {
            const res = await onConfirm(reason.trim());
            if (res && "error" in res && res.error) {
              toast.error(res.error);
              return;
            }
            toast.success(typeof successMessage === "function" ? successMessage(reason.trim()) : successMessage ?? "Done");
            setOpen(false);
            setReason("");
          })
        }
        className="rounded-md bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
      >
        {pending ? "…" : confirmLabel}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setOpen(false);
          setReason("");
        }}
        className="rounded-md border border-line px-2 py-1 text-xs text-muted"
      >
        Cancel
      </button>
    </div>
  );
}
