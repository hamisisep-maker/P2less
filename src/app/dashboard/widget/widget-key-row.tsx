"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateWidgetOriginsAction, deactivateWidgetKeyAction } from "@/lib/actions";

/** Real bug fixed in a UX audit, 2026-08-23 (Phase 2 — the highest client-risk
 *  gap found): both actions here were bare form submits with zero feedback of
 *  any kind — no confirmation, no pending state, no success/error signal.
 *  Deactivate kills a LIVE, publicly embedded widget key; once deactivated
 *  there's no "Reactivate" anywhere in this dashboard (the key row simply
 *  stops rendering — confirmed in dashboard/widget/page.tsx's `{k.active &&
 *  <WidgetKeyRow .../>}`), so the confirmation is honest about that rather
 *  than implying it's casually undoable. */
export function WidgetKeyRow({ id, canManage, origins }: { id: string; canManage: boolean; origins: string[] }) {
  const [value, setValue] = useState(origins.join("\n"));
  const [savePending, startSave] = useTransition();
  const [deactivatePending, startDeactivate] = useTransition();

  const onSave = () => {
    startSave(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("origins", value);
      const res = await updateWidgetOriginsAction(fd);
      if (res && "error" in res) toast.error(res.error);
      else toast.success("Allowed domains saved");
    });
  };

  const onDeactivate = () => {
    if (!window.confirm("Deactivate this widget key? Any website using it will stop showing the chat widget immediately. There's no reactivate for this exact key — you'd need to create a new one and update the embed snippet on your site.")) return;
    startDeactivate(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const res = await deactivateWidgetKeyAction(fd);
      if (res && "error" in res) toast.error(res.error);
      else toast.success("Widget key deactivated");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={1}
        placeholder="any domain (testing mode)"
        disabled={!canManage}
        className="min-w-[220px] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-xs outline-none focus:border-accent disabled:opacity-60"
      />
      {canManage && (
        <>
          <button type="button" onClick={onSave} disabled={savePending} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-60">
            {savePending ? "Saving…" : "Save domains"}
          </button>
          <button type="button" onClick={onDeactivate} disabled={deactivatePending} className="text-xs text-rose hover:underline disabled:opacity-60">
            {deactivatePending ? "…" : "Deactivate"}
          </button>
        </>
      )}
    </div>
  );
}
