import { checkDemoKey, unauthorized, findStudent } from "@/lib/demo-school";

export async function GET(req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (!checkDemoKey(req)) return unauthorized();
  const { externalId } = await params;
  const student = await findStudent(externalId);
  if (!student || !student.fees) return Response.json({ error: "Account not found" }, { status: 404 });
  const balance = student.fees.billed - student.fees.paid;
  return Response.json({
    student: { id: student.externalId, name: student.name, grade: student.grade },
    currency: student.fees.currency,
    billed: student.fees.billed,
    paid: student.fees.paid,
    balance,
    dueDate: student.fees.dueDate,
  });
}
