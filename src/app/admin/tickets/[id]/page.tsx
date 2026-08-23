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
          }}
          events={events.map((e) => ({ id: e.id, type: e.type, actorName: e.actorId ? actorNameById.get(e.actorId) ?? "Unknown admin" : "System", visibility: e.visibility, body: e.body, detail: e.detail, createdAt: e.createdAt }))}
          admins={admins}
          relatedIncident={relatedIncident ? { id: relatedIncident.id, number: relatedIncident.number, title: relatedIncident.title, status: relatedIncident.status } : null}
          relatedPayment={relatedPayment ? { id: relatedPayment.id, reference: relatedPayment.reference, amount: relatedPayment.amount, status: relatedPayment.status } : null}
          attachments={attachments.map((a) => ({ id: a.id, filename: a.filename, token: a.token, createdAt: a.createdAt }))}
          conversationMessages={conversationMessages.map((m) => ({ id: m.id, direction: m.direction, body: m.body, createdAt: m.createdAt }))}
          relatedMessage={relatedMessage ? { id: relatedMessage.id, direction: relatedMessage.direction, body: relatedMessage.body, createdAt: relatedMessage.createdAt } : null}
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
