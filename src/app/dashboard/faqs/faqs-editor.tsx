"use client";

import { useActionState, useState } from "react";
import { saveFaqsAction } from "@/lib/actions";
import { Card } from "@/components/ui";

type Faq = { q: string; a: string };
type State = { ok?: boolean; count?: number; error?: string } | null;

export function FaqsEditor({ initial, canManage }: { initial: Faq[]; canManage: boolean }) {
  const [rows, setRows] = useState<Faq[]>(initial.length ? initial : [{ q: "", a: "" }]);
  const [state, action, pending] = useActionState(saveFaqsAction, null as State);

  const update = (i: number, key: keyof Faq, value: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  const remove = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const add = () => setRows((r) => [...r, { q: "", a: "" }]);

  const payload = JSON.stringify(rows.map((r) => ({ q: r.q.trim(), a: r.a.trim() })).filter((r) => r.q && r.a));

  return (
    <form action={action}>
      <input type="hidden" name="faqs" value={payload} />

      {state?.ok && (
        <div className="mb-3 rounded-xl border border-green/30 bg-green-soft p-3 text-sm text-green">
          Saved — your assistant now uses {state.count} approved answer{state.count === 1 ? "" : "s"}.
        </div>
      )}
      {state?.error && <div className="mb-3 rounded-xl border border-rose/30 bg-rose-soft p-3 text-sm text-rose">{state.error}</div>}

      <div className="space-y-3">
        {rows.map((row, i) => (
          <Card key={i} className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">FAQ {i + 1}</span>
              {canManage && rows.length > 1 && (
                <button type="button" onClick={() => remove(i)} className="text-xs text-rose hover:underline">Remove</button>
              )}
            </div>
            <label className="mb-1 block text-xs text-muted">Question people might ask</label>
            <input
              value={row.q}
              onChange={(e) => update(i, "q", e.target.value)}
              disabled={!canManage}
              placeholder="e.g. What are the school hours?"
              className="mb-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
            />
            <label className="mb-1 block text-xs text-muted">Approved answer (used word-for-word)</label>
            <textarea
              value={row.a}
              onChange={(e) => update(i, "a", e.target.value)}
              disabled={!canManage}
              rows={2}
              placeholder="e.g. School runs Monday to Friday, 7:30am to 4:30pm."
              className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
            />
          </Card>
        ))}
      </div>

      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={add} className="rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-surface-2">
            + Add FAQ
          </button>
          <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-60">
            {pending ? "Saving…" : "Save FAQs"}
          </button>
        </div>
      )}
    </form>
  );
}
