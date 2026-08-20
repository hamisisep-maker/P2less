"use client";

import { updateWidgetOriginsAction, deactivateWidgetKeyAction } from "@/lib/actions";

export function WidgetKeyRow({ id, canManage, origins }: { id: string; canManage: boolean; origins: string[] }) {
  return (
    <form action={updateWidgetOriginsAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <textarea
        name="origins"
        defaultValue={origins.join("\n")}
        rows={1}
        placeholder="any domain (testing mode)"
        disabled={!canManage}
        className="min-w-[220px] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-xs outline-none focus:border-accent disabled:opacity-60"
      />
      {canManage && (
        <>
          <button type="submit" className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2">Save domains</button>
          <button type="submit" formAction={deactivateWidgetKeyAction} className="text-xs text-rose hover:underline">Deactivate</button>
        </>
      )}
    </form>
  );
}
