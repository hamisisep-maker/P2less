import { requireKey, unauthorized } from "@/lib/demo-auth";
import { db } from "@/lib/db";
import crypto from "node:crypto";

// WRITE endpoint on the external HR/payroll system: submit a leave request.
// P2Less reaches this via a POST connector action, after user confirmation.
export async function POST(req: Request) {
  if (!requireKey(req, process.env.DEMO_PAYROLL_API_KEY || "")) return unauthorized();
  let body: { employeeId?: string; startDate?: string; endDate?: string; reason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.employeeId || !body.startDate || !body.endDate) {
    return Response.json({ error: "employeeId, startDate and endDate are required" }, { status: 400 });
  }
  const employee = await db.demoEmployee.findUnique({ where: { externalId: body.employeeId } });
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });

  const reference = "LR-" + crypto.randomBytes(2).toString("hex").toUpperCase();
  const lr = await db.demoLeaveRequest.create({
    data: { reference, employeeId: employee.id, startDate: body.startDate, endDate: body.endDate, reason: body.reason || null, status: "pending" },
  });
  return Response.json({
    reference: lr.reference,
    employee: { id: employee.externalId, name: employee.name },
    startDate: lr.startDate,
    endDate: lr.endDate,
    reason: lr.reason,
    status: lr.status,
  });
}
