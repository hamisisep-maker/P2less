import { requireKey, unauthorized } from "@/lib/demo-auth";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  if (!requireKey(req, process.env.DEMO_PAYROLL_API_KEY || "")) return unauthorized();
  const { employeeId } = await params;
  const employee = await db.demoEmployee.findUnique({ where: { externalId: employeeId } });
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });
  return Response.json({
    employee: { id: employee.externalId, name: employee.name },
    leaveBalance: employee.leaveBalance,
    unit: "days",
  });
}
