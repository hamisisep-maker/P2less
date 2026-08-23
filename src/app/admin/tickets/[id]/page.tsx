import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdminPermission, hasAdminPermission } from "@/lib/admin-authz";
import { Card, PageHeader } from "@/components/ui";
import { TicketWorkspace } from "./ticket-workspace";

export default async function AdminTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: { tenant: { select: { id: true, name: true } }, contact: { select: { id: true, displayName: true, address: true } }, assignedAdmin: { select: { id: true, name: true, email: true } } },
  });
  if (!ticket) notFound();

  const admin = await requireAdminPermission("tickets.view", { tenantId: ticket.tenantId });

  const [events, admins, relatedIncident, relatedPayment, attachments, conversationMessages, relatedMessage] = await Promise.all([
    db.ticketEvent.findMany({ where: { ticketId: id }, orderBy: { createdAt: "asc" } }),
    db.user.findMany({ where: { OR: [{ isSuperAdmin: true }, { adminRoleId: { not: null } }] }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    ticket.relatedIncidentId ? db.incident.findUnique({ where: { id: ticket.relatedIncidentId } }) : null,
    ticket.relatedPaymentId ? db.payment.findUnique({ where: { id: ticket.relatedPaymentId } }) : null,
    db.document.findMany({ where: { ticketId: id }, orderBy: { createdAt: "desc" } }),
    // Waterfall step 1 material — the reviewer picks the specific message a
    // quality report is actually about from here, manually (see linkMessageAction).
    ticket.conversationId ? db.message.findMany({ where: { conversationId: ticket.conversationId }, orderBy: { createdAt: "desc" }, take: 30 }) : [],
    ticket.relatedMessageId ? db.message.findUnique({ where: { id: ticket.relatedMessageId } }) : null,
  ]);

  // Every message in a conversation shares its contact's channelType (a
  // Contact is unique per tenant+channel, so a conversation's messages never
  // span more than one channel) — Contact.channelType is the real source of
  // truth here, NOT Conversation.channelId/Channel.type, which are defined
  // in the schema but never actually get set on conversation creation
  // (confirmed: 0 of 177 real conversations have channelId populated).
  const conversationChannel = ticket.conversationId
    ? (await db.conversation.findUnique({ where: { id: ticket.conversationId }, select: { contact: { select: { channelType: true } } } }))?.contact.channelType ?? null
    : null;

  // System Trace (design doc's visualization proposal §8 — the highest-
  // leverage view). Only real if the linked message was created after
  // 2026-08-23 and actually has a requestId — older messages honestly show
  // "no trace available" rather than a fabricated one.
  const [traceAudit, traceAi] = relatedMessage?.requestId
    ? await Promise.all([
        db.auditLog.findMany({ where: { tenantId: ticket.tenantId, requestId: relatedMessage.requestId }, orderBy: { createdAt: "asc" } }),
        db.aiRequestLog.findMany({ where: { requestId: relatedMessage.requestId }, orderBy: { createdAt: "asc" } }),
      ])
    : [[], []];

  const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actorNameById = new Map(actors.map((a) => [a.id, a.name]));

  return (
    <div>
      <PageHeader
        title={`${ticket.number ?? ticket.id.slice(0, 8)} — ${ticket.subject}`}
        subtitle={`${ticket.tenant.name}${ticket.contact ? ` · ${ticket.contact.displayName ?? ticket.contact.address}` : ""}`}
      />
      <Card className="p-5">
        <TicketWorkspace
          ticket={{
            id: ticket.id, number: ticket.number, tenantId: ticket.tenantId, tenantName: ticket.tenant.name,
            subject: ticket.subject, description: ticket.description, category: ticket.category, priority: ticket.priority,
            status: ticket.status, assignedAdminId: ticket.assignedAdminId, assignedAdminName: ticket.assignedAdmin?.name ?? null,
            slaDeadlineAt: ticket.slaDeadlineAt, slaBreached: ticket.slaBreached,
            resolution: ticket.resolution, resolutionReason: ticket.resolutionReason, resolvedAt: ticket.resolvedAt,
            createdAt: ticket.createdAt, source: ticket.source, qualityCategory: ticket.qualityCategory,
            actionRequired: ticket.actionRequired, actionReason: ticket.actionReason,
          }}
          events={events.map((e) => ({ id: e.id, type: e.type, actorName: e.actorId ? actorNameById.get(e.actorId) ?? "Unknown admin" : "System", visibility: e.visibility, body: e.body, detail: e.detail, createdAt: e.createdAt }))}
          admins={admins}
          relatedIncident={relatedIncident ? { id: relatedIncident.id, number: relatedIncident.number, title: relatedIncident.title, status: relatedIncident.status } : null}
          relatedPayment={relatedPayment ? { id: relatedPayment.id, reference: relatedPayment.reference, amount: relatedPayment.amount, status: relatedPayment.status } : null}
          attachments={attachments.map((a) => ({ id: a.id, filename: a.filename, token: a.token, createdAt: a.createdAt }))}
          conversationMessages={conversationMessages.map((m) => ({ id: m.id, direction: m.direction, body: m.body, createdAt: m.createdAt }))}
          relatedMessage={relatedMessage ? { id: relatedMessage.id, direction: relatedMessage.direction, body: relatedMessage.body, createdAt: relatedMessage.createdAt } : null}
          conversationChannel={conversationChannel}
          traceAudit={traceAudit.map((a) => ({ id: a.id, action: a.action, target: a.target, success: a.success, detail: a.detail, createdAt: a.createdAt }))}
          traceAi={traceAi.map((r) => ({ id: r.id, provider: r.provider, model: r.model, feature: r.feature, costKes: r.costKes, totalTokens: r.totalTokens, success: r.success, createdAt: r.createdAt }))}
          permissions={{
            canManage: hasAdminPermission(admin, "tickets.manage"),
            canInternalNotes: hasAdminPermission(admin, "tickets.internal_notes"),
            canResolve: hasAdminPermission(admin, "tickets.resolve"),
          }}
        />
      </Card>
    </div>
  );
}
