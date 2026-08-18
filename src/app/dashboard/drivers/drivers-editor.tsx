"use client";

import { useActionState, useEffect, useState } from "react";
import { saveDriverAction, toggleDriverActiveAction } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";

type Driver = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  busy: boolean;
  availableDate: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
};
type State = { ok?: boolean; error?: string; editedId?: string } | null;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function availabilityLabel(d: Driver): { text: string; tone: "green" | "amber" | "neutral" } {
  if (d.busy) return { text: "On a delivery right now", tone: "amber" };
  if (d.availableDate === todayISO() && d.availableFrom && d.availableUntil) {
    return { text: `Available today ${d.availableFrom}–${d.availableUntil}`, tone: "green" };
  }
  if (d.availableDate === todayISO() && !d.availableFrom) {
    return { text: "Said not available today", tone: "neutral" };
  }
  return { text: "Hasn't confirmed today's availability yet", tone: "neutral" };
}

export function DriversEditor({ initial, canManage }: { initial: Driver[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Driver | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState(saveDriverAction, null as State);

  useEffect(() => {
    if (state?.ok) {
      setEditing(null);
      setFormKey((k) => k + 1);
    }
  }, [state]);

  return (
    <div>
      {canManage && (
        <Card className="mb-5 p-5">
          <h2 className="mb-3 font-semibold">{editing ? `Edit "${editing.name}"` : "Add a driver"}</h2>
          <form key={formKey} action={action} className="space-y-3">
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted">Name</label>
                <input name="name" required defaultValue={editing?.name} placeholder="e.g. Peter Mwangi" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">WhatsApp number</label>
                <input name="phone" required defaultValue={editing?.phone} placeholder="+254712345678" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              </div>
            </div>
            {state?.error && <p className="text-sm text-rose">{state.error}</p>}
            <div className="flex items-center gap-2">
              <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-60">
                {pending ? "Saving…" : editing ? "Save changes" : "Add driver"}
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
        {initial.length === 0 && <Card className="p-5 text-sm text-muted">No drivers yet — add your first one above.</Card>}
        {initial.map((d) => {
          const avail = availabilityLabel(d);
          return (
            <Card key={d.id} className={`p-4 ${!d.active ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.name}</span>
                    <Badge tone={avail.tone}>{avail.text}</Badge>
                    {!d.active && <Badge tone="rose">Inactive</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted">{d.phone}</p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => { setEditing(d); setFormKey((k) => k + 1); }} className="text-xs text-accent hover:underline">Edit</button>
                    <form action={toggleDriverActiveAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="text-xs text-muted hover:underline">{d.active ? "Deactivate" : "Reactivate"}</button>
                    </form>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
