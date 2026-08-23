"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge, timeAgo } from "@/components/ui";
import { EvidencePanel } from "@/components/evidence-panel";
import {
  assignTicketAction, updateTicketStatusAction, addInternalNoteAction, addCustomerResponseAction,
  linkIncidentAction, linkPaymentAction, resolveTicketAction, reopenTicketAction, addTicketAttachmentAction,
  setQualityCategoryAction, linkMessageAction, setActionDecisionAction,
} from "@/lib/ticket-actions";
import { QUALITY_CATEGORIES, TICKET_SOURCES, ACTION_DECISIONS } from "@/lib/quality-taxonomy";

type Ticket = {
  id: string; number: string | null; tenantId: string; tenantName: string;
  subject: string; description: string | null; category: string; priority: string; status: string;
  assignedAdminId: string | null; assignedAdminName: string | null;
  slaDeadlineAt: Date | null; slaBreached: boolean;
  resolution: string | null; resolutionReason: string | null; resolvedAt: Date | null;
  createdAt: Date; source: string; qualityCategory: string | null;
  actionRequired: string | null; actionReason: string | null;
};
type TicketEventRow = { id: string; type: string; actorName: string; visibility: string; body: string | null; detail: unknown; createdAt: Date };
type AdminOption = { id: string; name: string; email: string };
type RelatedIncident = { id: string; number: string | null; title: string; status: string } | null;
type RelatedPayment = { id: string; reference: string; amount: number; status: string } | null;
type Attachment = { id: string; filename: string; token: string; createdAt: Date };
type MessageRow = { id: string; direction: string; body: string; createdAt: Date };

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
  quality_classified: "Quality category set", linked_message: "Linked to message",
  action_decided: "Action decision recorded",
};
const SOURCE_TONE: Record<string, "neutral" | "indigo" | "green"> = { internal: "neutral", tenant: "indigo", public_report: "green" };

export function TicketWorkspace({ ticket, events, admins, relatedIncident, relatedPayment, attachments, conversationMessages, relatedMessage, permissions }: {
  ticket: Ticket; events: TicketEventRow[]; admins: AdminOption[];
  relatedIncident: RelatedIncident; relatedPayment: RelatedPayment; attachments: Attachment[];
  conversationMessages: MessageRow[]; relatedMessage: MessageRow | null;
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
  const [messagePick, setMessagePick] = useState("");
  const [actionPick, setActionPick] = useState(ticket.actionRequired ?? "");
  const [actionReasonDraft, setActionReasonDraft] = useState(ticket.actionReason ?? "");

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
        <Badge tone={SOURCE_TONE[ticket.source] ?? "neutral"} dot>{TICKET_SOURCES.find((s) => s.value === ticket.source)?.label.split(" — ")[0] ?? ticket.source}</Badge>
        {ticket.qualityCategory && <Badge tone="amber">{QUALITY_CATEGORIES.find((c) => c.value === ticket.qualityCategory)?.label ?? ticket.qualityCategory}</Badge>}
        {ticket.actionRequired && <Badge tone={ticket.actionRequired === "code_change" ? "rose" : ticket.actionRequired === "no_action" ? "green" : "indigo"}>{ACTION_DECISIONS.find((a) => a.value === ticket.actionRequired)?.label ?? ticket.actionRequired}</Badge>}
        {ticket.slaBreached && <Badge tone="rose">SLA breached</Badge>}
        {!ticket.slaBreached && ticket.slaDeadlineAt && <Badge tone="neutral">{dueIn(ticket.slaDeadlineAt)}</Badge>}
        <span className="text-xs text-muted">created <span suppressHydrationWarning>{timeAgo(ticket.createdAt)}</span> · {ticket.assignedAdminName ? `assigned to ${ticket.assignedAdminName}` : "unassigned"}</span>
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

      {/* ── Quality investigation waterfall (Phase A pilot,
          docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md) — setting a
          category here is what makes this ticket show up on
          /admin/quality, grouped by category. Independent of the ticket's
          normal status/lifecycle above. ── */}
      {(permissions.canManage || ticket.qualityCategory) && (
        <div className="rounded-xl border border-amber/30 bg-amber-soft/10 px-3.5 py-3">
          <h3 className="mb-2 text-sm font-semibold">Quality investigation</h3>
          {permissions.canManage ? (
            <select
              defaultValue={ticket.qualityCategory ?? ""}
              disabled={pending}
              onChange={(e) => run(() => setQualityCategoryAction(ticket.id, e.target.value), e.target.value ? "Quality category set" : "Removed from quality dashboard")}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="">Not a quality issue</option>
              {QUALITY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          ) : (
            <p className="text-xs text-muted">{ticket.qualityCategory ? QUALITY_CATEGORIES.find((c) => c.value === ticket.qualityCategory)?.label : "Not a quality issue."}</p>
          )}

          {/* Waterfall step 1 — pin the specific message this is actually about. */}
          <div className="mt-2.5 border-t border-line-soft pt-2.5">
            <div className="text-xs font-medium uppercase tracking-wide text-faint">Message this is about</div>
            {relatedMessage ? (
              <p className="mt-1 text-xs text-muted">
                <Badge tone={relatedMessage.direction === "in" ? "indigo" : "neutral"}>{relatedMessage.direction === "in" ? "from contact" : "from P2Less"}</Badge>
                <span className="ml-1.5" suppressHydrationWarning>{timeAgo(relatedMessage.createdAt)}</span> — “{relatedMessage.body.slice(0, 160)}”
              </p>
            ) : (
              <p className="mt-1 text-xs text-faint">None linked yet.</p>
            )}
            {permissions.canManage && conversationMessages.length > 0 && (
              <div className="mt-1.5 flex gap-1.5">
                <select value={messagePick} onChange={(e) => setMessagePick(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent">
                  <option value="">Pick a message from this conversation…</option>
                  {conversationMessages.map((m) => (
                    <option key={m.id} value={m.id}>{m.direction === "in" ? "← " : "→ "}{m.body.slice(0, 70)}</option>
                  ))}
                </select>
                <button disabled={pending || !messagePick} onClick={() => run(() => linkMessageAction(ticket.id, messagePick), "Message linked", () => setMessagePick(""))} className="rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-surface-2">Link</button>
              </div>
            )}
            {permissions.canManage && conversationMessages.length === 0 && (
              <p className="mt-1 text-xs text-faint">No conversation linked to this ticket yet.</p>
            )}
          </div>

          {/* Action decision — deliberately a SEPARATE step from the category
              above: root cause doesn't imply "needs a developer". Gated on
              a category already being set, enforcing Finding → Root Cause →
              Action Decision in that order, never skipped. A reason is
              required alongside the decision (enforced server-side too) —
              the point is an auditable "why this layer, not a cheaper one",
              not just a label. */}
          {ticket.qualityCategory && (
            <div className="mt-2.5 border-t border-line-soft pt-2.5">
              <div className="text-xs font-medium uppercase tracking-wide text-faint">Action required</div>
              {permissions.canManage ? (
                <div className="mt-1.5 space-y-1.5">
                  <select value={actionPick} onChange={(e) => setActionPick(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent">
                    <option value="">Not decided yet</option>
                    {ACTION_DECISIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  {actionPick && (
                    <>
                      <textarea
                        value={actionReasonDraft}
                        onChange={(e) => setActionReasonDraft(e.target.value)}
                        rows={2}
                        placeholder="Why this layer, not a cheaper one? (required)"
                        className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
                      />
                      <button
                        disabled={pending || !actionReasonDraft.trim()}
                        onClick={() => run(() => setActionDecisionAction(ticket.id, actionPick, actionReasonDraft), "Action decision recorded")}
                        className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
                      >
                        Save decision
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted">
                  {ticket.actionRequired ? `${ACTION_DECISIONS.find((a) => a.value === ticket.actionRequired)?.label} — ${ticket.actionReason}` : "Not decided yet."}
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
          {ticket.resolvedAt && <div className="mt-0.5 text-xs text-faint" suppressHydrationWarning>Resolved {timeAgo(ticket.resolvedAt)}</div>}
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
              {a.filename} <span className="text-faint" suppressHydrationWarning>({timeAgo(a.createdAt)})</span>
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
                <span className="text-xs text-faint" suppressHydrationWarning>{timeAgo(e.createdAt)}</span>
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
              <button
                disabled={pending || !responseText.trim()}
                onClick={() => startTransition(async () => {
                  const res: { error?: string; ok?: boolean; delivered?: boolean; deliveryNote?: string } = await addCustomerResponseAction(ticket.id, responseText);
                  if (res.error) { toast.error(res.error); return; }
                  if (res.delivered) toast.success("Delivered to the customer on WhatsApp");
                  else toast.warning(res.deliveryNote ?? "Response saved, but not delivered");
                  setResponseText("");
                })}
                className="mt-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
              >
                Send response
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
