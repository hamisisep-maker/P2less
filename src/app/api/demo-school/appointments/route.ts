import { checkDemoKey, unauthorized } from "@/lib/demo-school";
import { db } from "@/lib/db";
import crypto from "node:crypto";

// WRITE endpoint on the external school system: book a parent-teacher meeting.
// P2Less reaches this via a POST connector action, after user confirmation.
export async function POST(req: Request) {
  if (!checkDemoKey(req)) return unauthorized();
  let body: { studentId?: string; date?: string; time?: string; reason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.studentId || !body.date || !body.time) {
    return Response.json({ error: "studentId, date and time are required" }, { status: 400 });
  }
  const student = await db.demoStudent.findUnique({ where: { externalId: body.studentId } });
  if (!student) return Response.json({ error: "Student not found" }, { status: 404 });

  const reference = "APT-" + crypto.randomBytes(2).toString("hex").toUpperCase();
  const appt = await db.demoAppointment.create({
    data: { reference, studentId: student.id, date: body.date, time: body.time, reason: body.reason || "Parent-teacher meeting", status: "confirmed" },
  });
  return Response.json({
    reference: appt.reference,
    student: { id: student.externalId, name: student.name },
    date: appt.date,
    time: appt.time,
    reason: appt.reason,
    status: appt.status,
  });
}
