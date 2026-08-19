"use server";

import { revalidatePath } from "next/cache";
import { db } from "./db";
import { assertAdminPermission, logPrivilegedAction, ForbiddenError } from "./admin-authz";
import { nextTicketNumber } from "./ticket-numbering";
import { computeSlaDeadline } from "./ticket-sla";
import { storeTicketAttachment } from "./documents";

function isForbidden(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

function revalidateTicket(id: string) {
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${id}`);
}

/** Support-admin-created ticket (vs. the auto-created one from a WhatsApp
 *  escalation in conversation.ts) — e.g. the "Create ticket" quick action on
 *  Customer 360 when a support admin spots something worth tracking. */
export async function createTicketAction(input: {
  tenantId: string; subject: string; description?: string; category?: string; priority?: string; contactId?: string;
}) {
  if (!input.subject?.trim()) return { error: "A subject is required." };
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: input.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const priority = input.priority || "normal";
  const ticket = await db.supportTicket.create({
    data: {
      number: await nextTicketNumber(),
      tenantId: input.tenantId, contactId: input.contactId, subject: input.subject.trim(),
      description: input.description?.trim() || null, category: input.category || "general", priority,
      slaDeadlineAt: await computeSlaDeadline(priority),
    },
  });
  await db.ticketEvent.create({ data: { ticketId: ticket.id, type: "created", actorId: admin.id, visibility: "internal" } });
  await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: input.tenantId, action: "admin.ticket_created", target: ticket.number ?? ticket.id });
  revalidateTicket(ticket.id);
  return { ok: true, ticketId: ticket.id };
}

async function loadTicketOrError(ticketId: string) {
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { error: "Ticket not found." } as const;
  return { ticket } as const;
}

export async function assignTicketAction(ticketId: string, assignedAdminId: string) {
  const found = await loadTicketOrError(ticketId);
  if ("error" in found) return found;
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: found.ticket.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const assignee = await db.user.findUnique({ where: { id: assignedAdminId } });
  if (!assignee) return { error: "Admin not found." };
  await db.supportTicket.update({ where: { id: ticketId }, data: { assignedAdminId, status: found.ticket.status === "open" ? "assigned" : found.ticket.status } });
  await db.ticketEvent.create({ data: { ticketId, type: "assigned", actorId: admin.id, detail: { assignedAdminId, assignedAdminEmail: assignee.email } } });
  await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: found.ticket.tenantId, action: "admin.ticket_assigned", target: found.ticket.number ?? ticketId, detail: { assignedTo: assignee.email } });
  revalidateTicket(ticketId);
  return { ok: true };
}

const VALID_STATUSES = ["open", "assigned", "in_progress", "waiting_on_customer"];

export async function updateTicketStatusAction(ticketId: string, status: string) {
  if (!VALID_STATUSES.includes(status)) return { error: "Invalid status." };
  const found = await loadTicketOrError(ticketId);
  if ("error" in found) return found;
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: found.ticket.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const previousStatus = found.ticket.status;
  await db.supportTicket.update({ where: { id: ticketId }, data: { status } });
  await db.ticketEvent.create({ data: { ticketId, type: "status_changed", actorId: admin.id, detail: { previousStatus, status } } });
  await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: found.ticket.tenantId, action: "admin.ticket_status_changed", target: found.ticket.number ?? ticketId, previousState: { status: previousStatus }, newState: { status } });
  revalidateTicket(ticketId);
  return { ok: true };
}

/** Internal-only note — gated on tickets.internal_notes SEPARATELY from
 *  tickets.manage, so a future customer-facing role could respond to
 *  customers without ever seeing investigation notes. */
export async function addInternalNoteAction(ticketId: string, body: string) {
  if (!body?.trim()) return { error: "Note cannot be empty." };
  const found = await loadTicketOrError(ticketId);
  if ("error" in found) return found;
  let admin;
  try {
    admin = await assertAdminPermission("tickets.internal_notes", { tenantId: found.ticket.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await db.ticketEvent.create({ data: { ticketId, type: "internal_note", actorId: admin.id, visibility: "internal", body: body.trim() } });
  revalidateTicket(ticketId);
  return { ok: true };
}

/** Customer-visible response — a distinct visibility on the SAME TicketEvent
 *  stream as internal notes, so the two interleave chronologically instead of
 *  living in separate arrays (see TicketEvent's schema comment). */
export async function addCustomerResponseAction(ticketId: string, body: string) {
  if (!body?.trim()) return { error: "Response cannot be empty." };
  const found = await loadTicketOrError(ticketId);
  if ("error" in found) return found;
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: found.ticket.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await db.ticketEvent.create({ data: { ticketId, type: "customer_response", actorId: admin.id, visibility: "customer", body: body.trim() } });
  revalidateTicket(ticketId);
  return { ok: true };
}

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

/** Reuses the existing Document/storeTicketAttachment system — never a new
 *  file-storage path — same 5MB cap and type whitelist the product-image
 *  upload already established. */
export async function addTicketAttachmentAction(ticketId: string, formData: FormData) {
  const found = await loadTicketOrError(ticketId);
  if ("error" in found) return found;
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: found.ticket.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to attach." };
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: "File is too large (5MB max)." };
  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) return { error: "Only images and PDFs can be attached." };

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const doc = await storeTicketAttachment({ tenantId: found.ticket.tenantId, ticketId, filename: file.name, base64 });
  await db.ticketEvent.create({ data: { ticketId, type: "attachment_added", actorId: admin.id, detail: { filename: doc.filename, url: doc.url } } });
  revalidateTicket(ticketId);
  return { ok: true, url: doc.url };
}

export async function linkIncidentAction(ticketId: string, incidentIdOrNumber: string) {
  if (!incidentIdOrNumber?.trim()) return { error: "Enter an incident number or id." };
  const found = await loadTicketOrError(ticketId);
  if ("error" in found) return found;
  const q = incidentIdOrNumber.trim();
  const incident = await db.incident.findFirst({ where: { OR: [{ id: q }, { number: q }] } });
  if (!incident) return { error: "Incident not found." };
  const incidentId = incident.id;
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: found.ticket.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await db.supportTicket.update({ where: { id: ticketId }, data: { relatedIncidentId: incidentId } });
  await db.ticketEvent.create({ data: { ticketId, type: "linked_incident", actorId: admin.id, detail: { incidentId, incidentNumber: incident.number, incidentTitle: incident.title } } });
  await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: found.ticket.tenantId, action: "admin.ticket_linked_incident", target: found.ticket.number ?? ticketId, detail: { incidentNumber: incident.number } });
  revalidateTicket(ticketId);
  return { ok: true };
}

export async function linkPaymentAction(ticketId: string, paymentIdOrReference: string) {
  if (!paymentIdOrReference?.trim()) return { error: "Enter a payment reference or id." };
  const found = await loadTicketOrError(ticketId);
  if ("error" in found) return found;
  const q = paymentIdOrReference.trim();
  const payment = await db.payment.findFirst({ where: { OR: [{ id: q }, { reference: q }] } });
  if (!payment) return { error: "Payment not found." };
  if (payment.tenantId !== found.ticket.tenantId) return { error: "That payment belongs to a different tenant." };
  const paymentId = payment.id;
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: found.ticket.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await db.supportTicket.update({ where: { id: ticketId }, data: { relatedPaymentId: paymentId } });
  await db.ticketEvent.create({ data: { ticketId, type: "linked_payment", actorId: admin.id, detail: { paymentId, reference: payment.reference } } });
  await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: found.ticket.tenantId, action: "admin.ticket_linked_payment", target: found.ticket.number ?? ticketId, detail: { reference: payment.reference } });
  revalidateTicket(ticketId);
  return { ok: true };
}

/** The final, audited close — kept as its own gated action distinct from
 *  tickets.manage, same reasoning as incidents' separate resolve flow.
 *  Requires BOTH a resolution and a resolutionReason, never just a status flip. */
export async function resolveTicketAction(ticketId: string, resolution: string, resolutionReason: string) {
  if (!resolution?.trim() || !resolutionReason?.trim()) return { error: "Both a resolution and a resolution reason are required." };
  const found = await loadTicketOrError(ticketId);
  if ("error" in found) return found;
  if (found.ticket.status === "resolved" || found.ticket.status === "closed") return { error: "This ticket is already resolved." };
  let admin;
  try {
    admin = await assertAdminPermission("tickets.resolve", { tenantId: found.ticket.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await db.supportTicket.update({
    where: { id: ticketId },
    data: { status: "resolved", resolution, resolutionReason, resolvedAt: new Date(), resolvedById: admin.id },
  });
  await db.ticketEvent.create({ data: { ticketId, type: "resolved", actorId: admin.id, detail: { resolution, resolutionReason } } });
  await logPrivilegedAction({ admin, permission: "tickets.resolve", tenantId: found.ticket.tenantId, action: "admin.ticket_resolved", target: found.ticket.number ?? ticketId, reason: resolutionReason, detail: { resolution } });
  revalidateTicket(ticketId);
  return { ok: true };
}

/** A resolved/closed ticket found to be not-actually-fixed. Kept simple (no
 *  separate permission) — reopening is a lifecycle transition like any other
 *  status change, gated on the same tickets.manage as the rest of the
 *  lifecycle; the resolution/resolutionReason fields are left in place as a
 *  historical record rather than cleared, visible alongside the new "reopened"
 *  TicketEvent. */
export async function reopenTicketAction(ticketId: string, reason: string) {
  if (!reason?.trim()) return { error: "A reason is required to reopen a resolved ticket." };
  const found = await loadTicketOrError(ticketId);
  if ("error" in found) return found;
  if (found.ticket.status !== "resolved" && found.ticket.status !== "closed") return { error: "Only a resolved or closed ticket can be reopened." };
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: found.ticket.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await db.supportTicket.update({ where: { id: ticketId }, data: { status: "reopened" } });
  await db.ticketEvent.create({ data: { ticketId, type: "reopened", actorId: admin.id, body: reason.trim() } });
  await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: found.ticket.tenantId, action: "admin.ticket_reopened", target: found.ticket.number ?? ticketId, reason: reason.trim() });
  revalidateTicket(ticketId);
  return { ok: true };
}
