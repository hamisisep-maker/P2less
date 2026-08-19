"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge, timeAgo } from "@/components/ui";
import { EvidencePanel } from "@/components/evidence-panel";
import {
  assignTicketAction, updateTicketStatusAction, addInternalNoteAction, addCustomerResponseAction,
  linkIncidentAction, linkPaymentAction, resolveTicketAction, reopenTicketAction, addTicketAttachmentAction,
} from "@/lib/ticket-actions";

type Ticket = {
  id: string; number: string | null; tenantId: string; tenantName: string;
  subject: string; description: string | null; category: string; priority: string; status: string;
  assignedAdminId: string | null; assignedAdminName: string | null;
  slaDeadlineAt: Date | null; slaBreached: boolean;
  resolution: string | null; resolutionReason: string | null; resolvedAt: Date | null;
  createdAt: Date;
};
type TicketEventRow = { id: string; type: string; actorName: string; visibility: string; body: string | null; detail: unknown; createdAt: Date };
type AdminOption = { id: string; name: string; email: string };
type RelatedIncident = { id: string; number: string | null; title: string; status: string } | null;
type RelatedPayment = { id: string; reference: string; amount: number; status: string } | null;
type Attachment = { id: string; filename: string; token: string; createdAt: Date };

const STATUS_TONE: Record<string, "rose" | "amber" | "indigo" | "green" | "neutral"> = {
  open: "rose", assigned: "amber", in_progress: "indigo", waiting_on_customer: "amber",
  resolved: "green", closed: "green", reopened: "rose",
};
const VALID_STATUSES = ["open", "assigned", "in_progress", "waiting_on_customer"];
function dueIn(date: Date): string {
  const s = (date.getTime() - Date.now()) / 1000;
  if (s <= 0) return "overdue";
  if (s < 3600) return `due in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `due in ${Math.ceil(s / 3600)}h`;
  return `due in ${Math.ceil(s / 86400)}d`;
}

const EVENT_LABELS: Record<string, string> = {
  created: "Ticket created", assigned: "Assigned", status_changed: "Status changed", internal_note: "Internal note",
  customer_response: "Customer response", attachment_added: "Attachment added", linked_incident: "Linked to incident",
  linked_payment: "Linked to payment", resolved: "Resolved", reopened: "Reopened",
};

export function TicketWorkspace({ ticket, events, admins, relatedIncident, relatedPayment, attachments, permissions }: {
  ticket: Ticket; events: TicketEventRow[]; admins: AdminOption[];
  relatedIncident: RelatedIncident; relatedPayment: RelatedPayment; attachments: Attachment[];
  permissions: { canManage: boolean; canInternalNotes: boolean; canResolve: boolean };
}) {
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [responseText, setResponseText] = useState("");
  const [incidentQuery, setIncidentQuery] = useState("");
  const [paymentQuery, setPaymentQuery] = useState("");
  const [resolution, setResolution] = useState("");
  const [resolutionReason, setResolutionReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [showResolve, setShowResolve] = useState(false);
  const [showReopen, setShowReopen] = useState(false);

  const isTerminal = ticket.status === "resolved" || ticket.status === "closed";

  function run(action: () => Promise<{ ok?: boolean; error?: string }>, successMsg: string, onOk?: () => void) {
    startTransition(async () => {
      const res = await action();
      if (res.error) { toast.error(res.error); return; }
      toast.success(successMsg);
      onOk?.();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[ticket.status] ?? "neutral"}>{ticket.status.replace(/_/g, " ")}</Badge>
        <Badge tone="indigo" dot>{ticket.priority}</Badge>
        <Badge tone="neutral">{ticket.category}</Badge>
        {ticket.slaBreached && <Badge tone="rose">SLA breached</Badge>}
        {!ticket.slaBreached && ticket.slaDeadlineAt && <Badge tone="neutral">{dueIn(ticket.slaDeadlineAt)}</Badge>}
        <span className="text-xs text-muted">created {timeAgo(ticket.createdAt)} · {ticket.assignedAdminName ? `assigned to ${ticket.assignedAdminName}` : "unassigned"}</span>
      </div>

      {ticket.description && <p className="text-sm text-muted">{ticket.description}</p>}

      {/* ── Cross-links: payment / incident evidence, per the Customer Ops Centre workflow ── */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-faint">Related payment</div>
          {relatedPayment ? (
            <div className="mt-1">
              <span className="font-mono text-xs">{relatedPayment.reference}</span> · {relatedPayment.amount} KES · <Badge tone={relatedPayment.status === "paid" ? "green" : relatedPayment.status === "failed" ? "rose" : "amber"}>{relatedPayment.status}</Badge>
              <Link href={`/admin/tenants/${ticket.tenantId}`} className="ml-2 text-xs text-accent underline">Open evidence</Link>
            </div>
          ) : permissions.canManage ? (
            <div className="mt-1.5 flex gap-1.5">
              <input value={paymentQuery} onChange={(e) => setPaymentQuery(e.target.value)} placeholder="payment reference or id" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent" />
              <button disabled={pending} onClick={() => run(() => linkPaymentAction(ticket.id, paymentQuery), "Payment linked", () => setPaymentQuery(""))} className="rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-surface-2">Link</button>
            </div>
          ) : <div className="mt-1 text-xs text-faint">None linked</div>}
        </div>
        <div className="rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-faint">Related incident</div>
          {relatedIncident ? (
            <div className="mt-1">
              <span className="font-mono text-xs">{relatedIncident.number ?? relatedIncident.id.slice(0, 8)}</span> · {relatedIncident.title} · <Badge tone={relatedIncident.status === "resolved" ? "green" : "rose"}>{relatedIncident.status}</Badge>
            </div>
          ) : permissions.canManage ? (
            <div className="mt-1.5 flex gap-1.5">
              <input value={incidentQuery} onChange={(e) => setIncidentQuery(e.target.value)} placeholder="incident number or id" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent" />
              <button disabled={pending} onClick={() => run(() => linkIncidentAction(ticket.id, incidentQuery), "Incident linked", () => setIncidentQuery(""))} className="rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-surface-2">Link</button>
            </div>
          ) : <div className="mt-1 text-xs text-faint">None linked — this ticket may still be related to an open incident; a support admin can confirm one from the incident's own page.</div>}
        </div>
      </div>

      {/* ── Lifecycle controls ── */}
      {permissions.canManage && !isTerminal && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-soft px-3.5 py-3">
          <select defaultValue={ticket.assignedAdminId ?? ""} onChange={(e) => e.target.value && run(() => assignTicketAction(ticket.id, e.target.value), "Assigned")} disabled={pending} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs">
            <option value="" disabled>Assign to…</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select defaultValue={VALID_STATUSES.includes(ticket.status) ? ticket.status : ""} onChange={(e) => e.target.value && run(() => updateTicketStatusAction(ticket.id, e.target.value), "Status updated")} disabled={pending} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs">
            <option value="" disabled>Change status…</option>
            {VALID_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          {permissions.canResolve && (
            <button onClick={() => setShowResolve((v) => !v)} className="ml-auto rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3 py-1.5 text-xs font-semibold text-white">Resolve</button>
          )}
        </div>
      )}
      {isTerminal && permissions.canManage && (
        <div className="rounded-xl border border-line-soft px-3.5 py-3">
          <div className="text-sm"><b>Resolution:</b> {ticket.resolution}</div>
          <div className="text-sm"><b>Reason:</b> {ticket.resolutionReason}</div>
          {ticket.resolvedAt && <div className="mt-0.5 text-xs text-faint">Resolved {timeAgo(ticket.resolvedAt)}</div>}
          {!showReopen ? (
            <button onClick={() => setShowReopen(true)} className="mt-2 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2">Reopen</button>
          ) : (
            <div className="mt-2 flex gap-1.5">
              <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Why is this being reopened? (required)" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent" />
              <button disabled={pending} onClick={() => run(() => reopenTicketAction(ticket.id, reopenReason), "Ticket reopened", () => { setShowReopen(false); setReopenReason(""); })} className="rounded-lg bg-rose-soft px-2.5 py-1.5 text-xs font-semibold text-rose">Confirm reopen</button>
            </div>
          )}
        </div>
      )}
      {showResolve && (
        <div className="space-y-2 rounded-xl border border-accent/30 bg-accent-soft/20 px-3.5 py-3">
          <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Resolution (what was done) — required" className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent" />
          <input value={resolutionReason} onChange={(e) => setResolutionReason(e.target.value)} placeholder="Resolution reason (e.g. platform_bug, customer_error, duplicate) — required" className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent" />
          <button disabled={pending} onClick={() => run(() => resolveTicketAction(ticket.id, resolution, resolutionReason), "Ticket resolved", () => setShowResolve(false))} className="rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3 py-1.5 text-xs font-semibold text-white">Confirm resolve</button>
        </div>
      )}

      {/* ── Attachments — reuses the existing Document system, not a new file store ── */}
      <div className="rounded-xl border border-line-soft px-3.5 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Attachments</h3>
          {permissions.canManage && !isTerminal && (
            <label className="cursor-pointer rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2">
              {uploading ? "Uploading…" : "Upload file"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploading(true);
                  const fd = new FormData();
                  fd.set("file", file);
                  startTransition(async () => {
                    const res = await addTicketAttachmentAction(ticket.id, fd);
                    setUploading(false);
                    if (res.error) { toast.error(res.error); return; }
                    toast.success("Attachment added");
                  });
                }}
              />
            </label>
          )}
        </div>
        {attachments.length === 0 && <p className="text-xs text-muted">No attachments.</p>}
        <div className="space-y-1">
          {attachments.map((a) => (
            <a key={a.id} href={`/d/${a.token}`} target="_blank" rel="noreferrer" className="block text-xs text-accent underline">
              {a.filename} <span className="text-faint">({timeAgo(a.createdAt)})</span>
            </a>
          ))}
        </div>
      </div>

      {/* ── Interleaved timeline: internal notes + customer responses + every lifecycle event, one chronological stream ── */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
        <div className="space-y-2">
          {events.map((e) => (
            <div key={e.id} className="rounded-lg border border-line-soft px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
                  {e.type === "internal_note" || e.type === "customer_response" ? (
                    <Badge tone={e.visibility === "internal" ? "amber" : "green"}>{e.visibility === "internal" ? "internal only" : "customer-visible"}</Badge>
                  ) : null}
                  <span className="text-xs text-faint">— {e.actorName}</span>
                </div>
                <span className="text-xs text-faint">{timeAgo(e.createdAt)}</span>
              </div>
              {e.body && <p className="mt-1 text-muted">{e.body}</p>}
              <EvidencePanel detail={e.detail} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Write internal note / customer response ── */}
      {!isTerminal && (permissions.canInternalNotes || permissions.canManage) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {permissions.canInternalNotes && (
            <div className="rounded-xl border border-amber/30 bg-amber-soft/20 px-3.5 py-3">
              <div className="mb-1.5 text-xs font-medium text-amber">Internal note (not visible to the customer)</div>
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent" />
              <button disabled={pending || !noteText.trim()} onClick={() => run(() => addInternalNoteAction(ticket.id, noteText), "Note added", () => setNoteText(""))} className="mt-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2">Add note</button>
            </div>
          )}
          {permissions.canManage && (
            <div className="rounded-xl border border-green/30 bg-green-soft/20 px-3.5 py-3">
              <div className="mb-1.5 text-xs font-medium text-green">Customer-visible response</div>
              <textarea value={responseText} onChange={(e) => setResponseText(e.target.value)} rows={2} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent" />
              <button disabled={pending || !responseText.trim()} onClick={() => run(() => addCustomerResponseAction(ticket.id, responseText), "Response added", () => setResponseText(""))} className="mt-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2">Send response</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
