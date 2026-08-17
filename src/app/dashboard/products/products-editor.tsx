"use client";

import { useActionState, useEffect, useState } from "react";
import { saveProductAction, toggleProductActiveAction } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  category: string | null;
  sku: string | null;
  inStock: boolean;
  active: boolean;
};
type State = { ok?: boolean; error?: string; editedId?: string } | null;

export function ProductsEditor({ initial, canManage }: { initial: Product[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState(saveProductAction, null as State);

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
          <h2 className="mb-3 font-semibold">{editing ? `Edit "${editing.name}"` : "Add a product"}</h2>
          <form key={formKey} action={action} className="space-y-3">
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted">Name</label>
                <input name="name" required defaultValue={editing?.name} placeholder="e.g. School Sweater — Navy" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Category (optional)</label>
                <input name="category" defaultValue={editing?.category ?? ""} placeholder="e.g. Uniforms" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Price (KES)</label>
                <input name="price" type="number" min={1} required defaultValue={editing?.price} placeholder="1500" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">SKU (optional)</label>
                <input name="sku" defaultValue={editing?.sku ?? ""} placeholder="e.g. UNI-SW-NVY" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Description (optional)</label>
              <textarea name="description" defaultValue={editing?.description ?? ""} rows={2} placeholder="What customers see when they ask about it" className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" name="inStock" value="true" defaultChecked={editing?.inStock ?? true} className="rounded border-line" />
              In stock
            </label>
            {state?.error && <p className="text-sm text-rose">{state.error}</p>}
            <div className="flex items-center gap-2">
              <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-60">
                {pending ? "Saving…" : editing ? "Save changes" : "Add product"}
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
        {initial.length === 0 && <Card className="p-5 text-sm text-muted">No products yet — add your first one above.</Card>}
        {initial.map((p) => (
          <Card key={p.id} className={`p-4 ${!p.active ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.category && <Badge tone="neutral">{p.category}</Badge>}
                  {!p.inStock && <Badge tone="amber">Out of stock</Badge>}
                  {!p.active && <Badge tone="rose">Inactive</Badge>}
                </div>
                {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
                <p className="mt-1 text-sm font-medium text-ink">{p.currency} {p.price.toLocaleString("en-US")}</p>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => { setEditing(p); setFormKey((k) => k + 1); }} className="text-xs text-accent hover:underline">Edit</button>
                  <form action={toggleProductActiveAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-xs text-muted hover:underline">{p.active ? "Deactivate" : "Reactivate"}</button>
                  </form>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
