"use client";

import { useTransition } from "react";
import { toast } from "sonner";

type ToggleResult = { ok: true; active: boolean } | { error: string } | void;

/** Shared Deactivate/Reactivate control for dashboard editors (Products,
 *  Delivery zones, Drivers) — a real bug found in a UX audit, 2026-08-23:
 *  all three previously used a bare `<form action={...}>` with zero
 *  feedback of any kind (no pending state, no confirmation, no success/
 *  error signal), so a click silently flipped a record active/inactive
 *  with no visible result. Deactivating asks for confirmation (it hides
 *  the record from the assistant); reactivating doesn't, since it's the
 *  safe/undo direction. */
export function ToggleActiveButton({
  id,
  active,
  itemLabel,
  action,
}: {
  id: string;
  active: boolean;
  itemLabel: string;
  action: (formData: FormData) => Promise<ToggleResult>;
}) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    if (active && !window.confirm(`Deactivate this ${itemLabel.toLowerCase()}? It won't be offered to customers until you reactivate it.`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const res = await action(fd);
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success(`${itemLabel} ${active ? "deactivated" : "reactivated"}`);
      }
    });
  };

  return (
    <button type="button" onClick={onClick} disabled={pending} className="text-xs text-muted hover:underline disabled:opacity-60">
      {pending ? "…" : active ? "Deactivate" : "Reactivate"}
    </button>
  );
}
