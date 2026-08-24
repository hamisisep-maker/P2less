"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "./db";
import { normalizePhone } from "./conversation";
import { withAssertAdminPermission, logPrivilegedAction } from "./admin-authz";

// Excludes 0/O and 1/I — easy to misread on a phone screen. 8 chars from this
// 32-char alphabet is ~40 bits of entropy — not brute-forceable by a stranger
// typing guesses into WhatsApp, while still short enough to read out loud or
// paste into a broadcast message.
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateJoinCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  return code;
}

/** Minimal v1 of the training-session design (docs/PUBLIC-FEEDBACK-QUALITY-
 *  CENTRE-2026-08-23.md's TestExercise section). Reuses tickets.manage —
 *  the same Phase A decision already documented for Quality Centre access —
 *  rather than adding new RBAC surface for a v1. Only one active session
 *  per tenant at a time (a real, deliberate v1 simplification, not an
 *  oversight — multiple concurrent sessions is real future scope). */
export async function createTrainingSessionAction(tenantId: string, name: string, questionsPerParticipant: number, maxParticipants: number | null) {
  if (!name?.trim()) return { error: "A session name is required." };
  if (!Number.isInteger(questionsPerParticipant) || questionsPerParticipant < 1) return { error: "Questions per participant must be a positive whole number." };
  if (maxParticipants !== null && (!Number.isInteger(maxParticipants) || maxParticipants < 1)) return { error: "Max participants must be a positive whole number, or left blank for no cap." };
  return withAssertAdminPermission("tickets.manage", async (admin) => {
    const existing = await db.trainingSession.findFirst({ where: { tenantId, status: "active" } });
    if (existing) return { error: `"${existing.name}" is already active for this tenant — end it before starting a new one.` };

    const session = await db.trainingSession.create({ data: { tenantId, name: name.trim(), questionsPerParticipant, maxParticipants, joinCode: generateJoinCode() } });
    await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId, action: "admin.training_session_created", target: session.id, detail: { name: session.name, questionsPerParticipant, maxParticipants } });
    revalidatePath("/admin/quality");
    return { ok: true };
  }, { tenantId });
}

export async function endTrainingSessionAction(sessionId: string) {
  const session = await db.trainingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { error: "Session not found." };
  return withAssertAdminPermission("tickets.manage", async (admin) => {
    await db.trainingSession.update({ where: { id: sessionId }, data: { status: "completed", endedAt: new Date() } });
    await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: session.tenantId, action: "admin.training_session_ended", target: sessionId });
    revalidatePath("/admin/quality");
    return { ok: true };
  }, { tenantId: session.tenantId });
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
  return withAssertAdminPermission("tickets.manage", async (admin) => {
    const address = normalizePhone(phoneNumber);
    if (!address) return { error: "Enter a valid phone number." };

    let contact = await db.contact.findFirst({ where: { tenantId: session.tenantId, address } });
    if (!contact) {
      contact = await db.contact.create({ data: { tenantId: session.tenantId, channelType: "whatsapp", address, displayName: address } });
    }

    // Atomic — the cap check and the insert happen inside one transaction so
    // two enrollments landing at the same instant can't both slip in past
    // maxParticipants, the same race-condition standard applied to the
    // per-participant question counter in conversation.ts.
    const contactId = contact.id;
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.trainingParticipant.findUnique({ where: { sessionId_contactId: { sessionId, contactId } } });
      if (existing) return { error: `${address} is already enrolled in this session.` } as const;
      if (session.maxParticipants !== null) {
        const count = await tx.trainingParticipant.count({ where: { sessionId } });
        if (count >= session.maxParticipants) return { error: `This session is full (${session.maxParticipants} participants) — end it or increase the cap before enrolling more.` } as const;
      }
      await tx.trainingParticipant.create({ data: { sessionId, contactId } });
      return { error: null } as const;
    });
    if (result.error) return { error: result.error };

    await logPrivilegedAction({ admin, permission: "tickets.manage", tenantId: session.tenantId, action: "admin.training_participant_added", target: contactId, detail: { sessionId, address } });
    revalidatePath("/admin/quality");
    return { ok: true };
  }, { tenantId: session.tenantId });
}
