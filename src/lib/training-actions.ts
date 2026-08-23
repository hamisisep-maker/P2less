"use server";

import { revalidatePath } from "next/cache";
import { db } from "./db";
import { normalizePhone } from "./conversation";
import { assertAdminPermission, logPrivilegedAction, ForbiddenError } from "./admin-authz";

function isForbidden(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

/** Minimal v1 of the training-session design (docs/PUBLIC-FEEDBACK-QUALITY-
 *  CENTRE-2026-08-23.md's TestExercise section). Reuses tickets.manage —
 *  the same Phase A decision already documented for Quality Centre access —
 *  rather than adding new RBAC surface for a v1. Only one active session
 *  per tenant at a time (a real, deliberate v1 simplification, not an
 *  oversight — multiple concurrent sessions is real future scope). */
export async function createTrainingSessionAction(tenantId: string, name: string, questionsPerParticipant: number) {
  if (!name?.trim()) return { error: "A session name is required." };
  if (!Number.isInteger(questionsPerParticipant) || questionsPerParticipant < 1) return { error: "Questions per participant must be a positive whole number." };
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const existing = await db.trainingSession.findFirst({ where: { tenantId, status: "active" } });
  if (existing) return { error: `"${existing.name}" is already active for this tenant — end it before starting a new one.` };

  const session = await db.trainingSession.create({ data: { tenantId, name: name.trim(), questionsPerParticipant } });
  await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId, action: "admin.training_session_created", target: session.id, detail: { name: session.name, questionsPerParticipant } });
  revalidatePath("/admin/quality");
  return { ok: true };
}

export async function endTrainingSessionAction(sessionId: string) {
  const session = await db.trainingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { error: "Session not found." };
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: session.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  await db.trainingSession.update({ where: { id: sessionId }, data: { status: "completed", endedAt: new Date() } });
  await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: session.tenantId, action: "admin.training_session_ended", target: sessionId });
  revalidatePath("/admin/quality");
  return { ok: true };
}

/** The actual safety boundary for the whole feature: a contact only ever
 *  counts toward a session — and only ever sees the training gate at all —
 *  once an admin has explicitly added them here. An active session never
 *  changes behavior for anyone who wasn't. Reuses/creates the same Contact
 *  row conversation.ts uses for this tenant+number, so an enrolled tester
 *  is identified exactly the way any other inbound message identifies them. */
export async function addTrainingParticipantAction(sessionId: string, phoneNumber: string) {
  const session = await db.trainingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { error: "Session not found." };
  if (session.status !== "active") return { error: "This session has ended." };
  let admin;
  try {
    admin = await assertAdminPermission("tickets.manage", { tenantId: session.tenantId });
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const address = normalizePhone(phoneNumber);
  if (!address) return { error: "Enter a valid phone number." };

  let contact = await db.contact.findFirst({ where: { tenantId: session.tenantId, address } });
  if (!contact) {
    contact = await db.contact.create({ data: { tenantId: session.tenantId, channelType: "whatsapp", address, displayName: address } });
  }
  const existing = await db.trainingParticipant.findUnique({ where: { sessionId_contactId: { sessionId, contactId: contact.id } } });
  if (existing) return { error: `${address} is already enrolled in this session.` };

  await db.trainingParticipant.create({ data: { sessionId, contactId: contact.id } });
  await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: session.tenantId, action: "admin.training_participant_added", target: contact.id, detail: { sessionId, address } });
  revalidatePath("/admin/quality");
  return { ok: true };
}
