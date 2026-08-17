import { requireKey, unauthorized } from "@/lib/demo-auth";
import { db } from "@/lib/db";
import crypto from "node:crypto";

// CREATE — book a meeting for an employee. POST { employeeId, date, time, topic? }.
export async function POST(req: Request) {
  if (!requireKey(req, process.env.DEMO_PAYROLL_API_KEY || "")) return unauthorized();
  let body: { employeeId?: string; date?: string; time?: string; topic?: string };
  try { body = (await req.json()) as typeof body; } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.employeeId || !body.date || !body.time) return Response.json({ error: "employeeId, date and time are required" }, { status: 400 });
  const employee = await db.demoEmployee.findUnique({ where: { externalId: body.employeeId } });
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });
  const reference = "MTG-" + crypto.randomBytes(2).toString("hex").toUpperCase();
  const m = await db.demoMeeting.create({ data: { reference, employeeId: employee.id, date: body.date, time: body.time, topic: body.topic || "Meeting", status: "confirmed" } });
  return Response.json({ employee: { id: employee.externalId, name: employee.name }, reference: m.reference, date: m.date, time: m.time, topic: m.topic, status: m.status });
}
