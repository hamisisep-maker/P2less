"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveDeliveryZoneAction, toggleDeliveryZoneActiveAction } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { ToggleActiveButton } from "@/components/toggle-active-button";

type Zone = { id: string; name: string; description: string | null; fee: number; active: boolean };
type State = { ok?: boolean; error?: string; editedId?: string; unchanged?: boolean } | null;

export function DeliveryZonesEditor({ initial, canManage }: { initial: Zone[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Zone | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState(saveDeliveryZoneAction, null as State);

  useEffect(() => {
    if (state?.ok) {
      if (state.unchanged) toast("No changes were made");
      else toast.success(state.editedId ? "Delivery zone updated" : "Delivery zone added");
      setEditing(null);
      setFormKey((k) => k + 1);
    }
  }, [state]);

  return (
    <div>
      {canManage && (
        <Card className="mb-5 p-5">
          <h2 className="mb-3 font-display font-semibold">{editing ? `Edit "${editing.name}"` : "Add a delivery zone"}</h2>
          <form key={formKey} action={action} className="space-y-3">
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted">Zone name</label>
                <input name="name" required defaultValue={editing?.name} placeholder="e.g. Within Nairobi CBD" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Delivery fee (KES)</label>
                <input name="fee" type="number" min={0} required defaultValue={editing?.fee} placeholder="200" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Areas / landmarks (optional)</label>
              <textarea name="description" defaultValue={editing?.description ?? ""} rows={2} placeholder="e.g. CBD, Moi Avenue, Tom Mboya Street, Kencom" className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              <p className="mt-1 text-xs text-faint">Helps the assistant match a customer's address to this zone.</p>
            </div>
            {state?.error && <p className="text-sm text-rose">{state.error}</p>}
            <div className="flex items-center gap-2">
              <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0">
                {pending ? "Saving…" : editing ? "Save changes" : "Add zone"}
              </button>
              {editing && (
                <button type="button" onClick={() => { setEditing(null); setFormKey((k) => k + 1); }} className="rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-surface-2">
                  Cancel
                </button>
              )}
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-2">
        {initial.length === 0 && <Card className="p-5 text-sm text-muted">No delivery zones yet — add your first one above.</Card>}
        {initial.map((z) => (
          <Card key={z.id} className={`p-4 ${!z.active ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{z.name}</span>
                  {!z.active && <Badge tone="rose">Inactive</Badge>}
                </div>
                {z.description && <p className="mt-1 text-sm text-muted">{z.description}</p>}
                <p className="mt-1 text-sm font-medium text-ink">KES {z.fee.toLocaleString("en-US")}</p>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => { setEditing(z); setFormKey((k) => k + 1); }} className="text-xs text-accent hover:underline">Edit</button>
                  <ToggleActiveButton id={z.id} active={z.active} itemLabel="Delivery zone" action={toggleDeliveryZoneActiveAction} />
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
