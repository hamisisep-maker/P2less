import { requireKey, unauthorized } from "@/lib/demo-auth";
import { db } from "@/lib/db";

async function nextMeeting(employeeId: string) {
  const employee = await db.demoEmployee.findUnique({ where: { externalId: employeeId } });
  if (!employee) return { employee: null as null };
  const meeting = await db.demoMeeting.findFirst({ where: { employeeId: employee.id, status: "confirmed" }, orderBy: [{ date: "asc" }, { time: "asc" }] });
  return { employee, meeting };
}

// READ — the employee's next meeting.
export async function GET(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  if (!requireKey(req, process.env.DEMO_PAYROLL_API_KEY || "")) return unauthorized();
  const { employeeId } = await params;
  const { employee, meeting } = await nextMeeting(employeeId);
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });
  if (!meeting) return Response.json({ employee: { id: employee.externalId, name: employee.name }, hasMeeting: false });
  return Response.json({ employee: { id: employee.externalId, name: employee.name }, hasMeeting: true, reference: meeting.reference, date: meeting.date, time: meeting.time, topic: meeting.topic });
}

// UPDATE — reschedule the next meeting. PATCH { date, time? }.
export async function PATCH(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  if (!requireKey(req, process.env.DEMO_PAYROLL_API_KEY || "")) return unauthorized();
  const { employeeId } = await params;
  const { employee, meeting } = await nextMeeting(employeeId);
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });
  if (!meeting) return Response.json({ error: "No meeting to reschedule" }, { status: 404 });
  let body: { date?: string; time?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const m = await db.demoMeeting.update({ where: { id: meeting.id }, data: { date: body.date ?? meeting.date, time: body.time ?? meeting.time } });
  return Response.json({ employee: { id: employee.externalId, name: employee.name }, reference: m.reference, date: m.date, time: m.time, status: "rescheduled" });
}

// DELETE — cancel the next meeting.
export async function DELETE(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  if (!requireKey(req, process.env.DEMO_PAYROLL_API_KEY || "")) return unauthorized();
  const { employeeId } = await params;
  const { employee, meeting } = await nextMeeting(employeeId);
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });
  if (!meeting) return Response.json({ error: "No meeting to cancel" }, { status: 404 });
  await db.demoMeeting.update({ where: { id: meeting.id }, data: { status: "cancelled" } });
  return Response.json({ employee: { id: employee.externalId, name: employee.name }, reference: meeting.reference, status: "cancelled" });
}
