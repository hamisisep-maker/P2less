"use server";

import { revalidatePath } from "next/cache";
import { db } from "./db";
import { assertAdminPermission, logPrivilegedAction, ForbiddenError } from "./admin-authz";
import { runJobNow } from "./job-runner";

function isForbidden(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

/** Detected -> Acknowledged -> Investigating -> Resolved. Every transition
 *  writes both an IncidentEvent (the incident's own timeline) and a
 *  PlatformAuditLog row via logPrivilegedAction — "this became part of the
 *  audit trail" per the spec, not a separate/parallel record. */
export async function acknowledgeIncidentAction(incidentId: string) {
  let admin;
  try {
    admin = await assertAdminPermission("incidents.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident) return { error: "Incident not found." };
  if (incident.status !== "detected") return { error: `Cannot acknowledge — this incident is already "${incident.status}".` };

  await db.incident.update({ where: { id: incidentId }, data: { status: "acknowledged", acknowledgedById: admin.id, acknowledgedAt: new Date() } });
  await db.incidentEvent.create({ data: { incidentId, type: "acknowledged", actorId: admin.id } });
  await logPrivilegedAction({ admin, permission: "incidents.manage", action: "admin.incident_acknowledged", target: incident.title });
  revalidatePath("/admin/incidents");
  return { ok: true };
}

export async function startInvestigatingIncidentAction(incidentId: string) {
  let admin;
  try {
    admin = await assertAdminPermission("incidents.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident) return { error: "Incident not found." };
  if (!["detected", "acknowledged"].includes(incident.status)) return { error: `Cannot start investigating — this incident is already "${incident.status}".` };

  await db.incident.update({ where: { id: incidentId }, data: { status: "investigating", investigatingAt: new Date() } });
  await db.incidentEvent.create({ data: { incidentId, type: "investigating", actorId: admin.id } });
  await logPrivilegedAction({ admin, permission: "incidents.manage", action: "admin.incident_investigating", target: incident.title });
  revalidatePath("/admin/incidents");
  return { ok: true };
}

export async function resolveIncidentAction(incidentId: string, cause: string, resolutionNote: string) {
  if (!cause?.trim() || !resolutionNote?.trim()) return { error: "Both a cause and a resolution are required." };
  let admin;
  try {
    admin = await assertAdminPermission("incidents.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident) return { error: "Incident not found." };
  if (incident.status === "resolved") return { error: "This incident is already resolved." };

  await db.incident.update({
    where: { id: incidentId },
    data: { status: "resolved", resolvedById: admin.id, resolvedAt: new Date(), cause, resolutionNote },
  });
  await db.incidentEvent.create({ data: { incidentId, type: "resolved", actorId: admin.id, note: resolutionNote, detail: { cause } } });
  await logPrivilegedAction({
    admin, permission: "incidents.manage", action: "admin.incident_resolved", target: incident.title,
    reason: resolutionNote, detail: { cause },
  });
  revalidatePath("/admin/incidents");
  return { ok: true };
}

export async function addIncidentCommentAction(incidentId: string, note: string) {
  if (!note?.trim()) return { error: "Comment cannot be empty." };
  let admin;
  try {
    admin = await assertAdminPermission("incidents.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident) return { error: "Incident not found." };
  await db.incidentEvent.create({ data: { incidentId, type: "comment", actorId: admin.id, note } });
  revalidatePath("/admin/incidents");
  return { ok: true };
}

export async function runIncidentSweepNowAction() {
  let admin;
  try {
    admin = await assertAdminPermission("incidents.manage");
  } catch (e) {
    if (isForbidden(e)) return { error: e.message };
    throw e;
  }
  const result = await runJobNow("incident_sweep", `manual:${admin.id}`);
  revalidatePath("/admin/incidents");
  return result;
}
