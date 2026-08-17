import { checkDemoKey, unauthorized } from "@/lib/demo-school";
import { db } from "@/lib/db";

// The student's next upcoming appointment ("When is my next appointment?").
export async function GET(req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (!checkDemoKey(req)) return unauthorized();
  const { externalId } = await params;
  const student = await db.demoStudent.findUnique({ where: { externalId } });
  if (!student) return Response.json({ error: "Student not found" }, { status: 404 });
  const next = await db.demoAppointment.findFirst({
    where: { studentId: student.id, status: "confirmed" },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });
  if (!next) {
    return Response.json({ student: { id: student.externalId, name: student.name }, hasAppointment: false });
  }
  return Response.json({
    student: { id: student.externalId, name: student.name },
    hasAppointment: true,
    reference: next.reference,
    date: next.date,
    time: next.time,
    reason: next.reason,
  });
}

// UPDATE — reschedule the student's next appointment. PATCH { date, time? }.
export async function PATCH(req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (!checkDemoKey(req)) return unauthorized();
  const { externalId } = await params;
  const student = await db.demoStudent.findUnique({ where: { externalId } });
  if (!student) return Response.json({ error: "Student not found" }, { status: 404 });
  const next = await db.demoAppointment.findFirst({ where: { studentId: student.id, status: "confirmed" }, orderBy: [{ date: "asc" }, { time: "asc" }] });
  if (!next) return Response.json({ error: "No appointment to reschedule" }, { status: 404 });
  let body: { date?: string; time?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const updated = await db.demoAppointment.update({ where: { id: next.id }, data: { date: body.date ?? next.date, time: body.time ?? next.time } });
  return Response.json({ student: { id: student.externalId, name: student.name }, reference: updated.reference, date: updated.date, time: updated.time, status: "rescheduled" });
}

// DELETE — cancel the student's next appointment.
export async function DELETE(req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (!checkDemoKey(req)) return unauthorized();
  const { externalId } = await params;
  const student = await db.demoStudent.findUnique({ where: { externalId } });
  if (!student) return Response.json({ error: "Student not found" }, { status: 404 });
  const next = await db.demoAppointment.findFirst({ where: { studentId: student.id, status: "confirmed" }, orderBy: [{ date: "asc" }, { time: "asc" }] });
  if (!next) return Response.json({ error: "No appointment to cancel" }, { status: 404 });
  await db.demoAppointment.update({ where: { id: next.id }, data: { status: "cancelled" } });
  return Response.json({ student: { id: student.externalId, name: student.name }, reference: next.reference, status: "cancelled" });
}
