"use client";

import { useTransition } from "react";
import { toast } from "sonner";

type ActionResult = { ok: true } | { error: string } | void;

/** A generalized, lighter-weight sibling to admin's `ReasonAction` for the
 *  tenant dashboard — real bugs found in a UX audit, 2026-08-23 (Phase 3):
 *  API-key Revoke and webhook Delete on `/dashboard/developers` were bare
 *  form actions with zero feedback (no confirmation before a permanent,
 *  irreversible action, no pending state, no success/error signal). Skips
 *  `ReasonAction`'s required-typed-reason friction on purpose — that's
 *  proportionate for admin actions affecting OTHER tenants/platform state,
 *  not a tenant managing their own resources. */
export function ConfirmActionButton({
  id,
  idFieldName = "id",
  label,
  confirmMessage,
  successMessage,
  action,
  className,
}: {
  id: string;
  idFieldName?: string;
  label: string;
  confirmMessage: string;
  successMessage: string;
  action: (formData: FormData) => Promise<ActionResult>;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    if (!window.confirm(confirmMessage)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set(idFieldName, id);
      const res = await action(fd);
      if (res && "error" in res) toast.error(res.error);
      else toast.success(successMessage);
    });
  };

  return (
    <button type="button" onClick={onClick} disabled={pending} className={className ?? "text-xs text-rose hover:underline disabled:opacity-60"}>
      {pending ? "…" : label}
    </button>
  );
}
