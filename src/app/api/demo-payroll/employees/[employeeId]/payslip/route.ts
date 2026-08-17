import { requireKey, unauthorized } from "@/lib/demo-auth";
import { db } from "@/lib/db";

// DEMO EXTERNAL SYSTEM: Hamzone Payroll. Returns the latest payslip for an
// employee. Reached only via a P2Less connector with the payroll API key.
export async function GET(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  if (!requireKey(req, process.env.DEMO_PAYROLL_API_KEY || "")) return unauthorized();
  const { employeeId } = await params;
  const employee = await db.demoEmployee.findUnique({
    where: { externalId: employeeId },
    include: { payslips: { orderBy: { period: "desc" }, take: 1 } },
  });
  if (!employee || employee.payslips.length === 0) {
    return Response.json({ error: "Payslip not found" }, { status: 404 });
  }
  const p = employee.payslips[0];
  return Response.json({
    employee: { id: employee.externalId, name: employee.name, title: employee.title },
    period: p.period,
    currency: p.currency,
    gross: p.gross,
    deductions: p.deductions,
    net: p.net,
  });
}
