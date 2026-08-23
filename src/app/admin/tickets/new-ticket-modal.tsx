"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Modal } from "@/components/dashboard-ui";
import { createTicketAction } from "@/lib/ticket-actions";
import { QUALITY_CATEGORIES, TICKET_SOURCES } from "@/lib/quality-taxonomy";

type State = { error?: string; ok?: boolean; ticketId?: string } | null;

function NewTicketForm({ tenants, fixedTenant, onDone }: { tenants: { id: string; name: string }[]; fixedTenant?: { id: string; name: string }; onDone: (ticketId: string) => void }) {
  const bound = async (_prev: State, formData: FormData) =>
    createTicketAction({
      tenantId: fixedTenant?.id ?? String(formData.get("tenantId") ?? ""),
      subject: String(formData.get("subject") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      category: String(formData.get("category") ?? "general"),
      priority: String(formData.get("priority") ?? "normal"),
      source: String(formData.get("source") ?? "internal"),
      qualityCategory: String(formData.get("qualityCategory") ?? "") || undefined,
    });
  const [state, action, pending] = useActionState<State, FormData>(bound, null);

  useEffect(() => {
    if (state?.ok && state.ticketId) { toast.success("Ticket created"); onDone(state.ticketId); }
    if (state?.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      {fixedTenant ? (
        <div className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-medium">{fixedTenant.name}</div>
      ) : (
        <label className="block">
          <span className="text-xs font-medium text-muted">Tenant (required)</span>
          <select name="tenantId" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
            <option value="">Select a tenant…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
      <label className="block">
        <span className="text-xs font-medium text-muted">Subject (required)</span>
        <input name="subject" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Description</span>
        <textarea name="description" rows={3} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-medium text-muted">Category</span>
          <select name="category" defaultValue="general" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
            {["general", "billing", "technical", "account", "whatsapp", "ai", "other"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Priority</span>
          <select name="priority" defaultValue="normal" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
            {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted">Source</span>
        <select name="source" defaultValue="internal" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          {TICKET_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Quality issue? (optional — puts this on the Quality Centre triage dashboard)</span>
        <select name="qualityCategory" defaultValue="" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          <option value="">Not a quality issue</option>
          {QUALITY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Creating…" : "Create ticket"}
      </button>
    </form>
  );
}

export function NewTicketModal({ tenants, fixedTenant, triggerLabel }: { tenants: { id: string; name: string }[]; fixedTenant?: { id: string; name: string }; triggerLabel?: string }) {
  const router = useRouter();
  return (
    <Modal title="New support ticket" description="For a problem a support admin spots or logs on the customer's behalf." trigger={
      <button className="flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white">
        <Plus size={14} /> {triggerLabel ?? "New ticket"}
      </button>
    }>
      <NewTicketForm tenants={tenants} fixedTenant={fixedTenant} onDone={(id) => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); router.push(`/admin/tickets/${id}`); }} />
    </Modal>
  );
}
