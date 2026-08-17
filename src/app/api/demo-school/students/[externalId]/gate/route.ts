import { checkDemoKey, unauthorized, findStudent } from "@/lib/demo-school";

// Today's gate check-in / check-out status ("Has John arrived at school?").
export async function GET(req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (!checkDemoKey(req)) return unauthorized();
  const { externalId } = await params;
  const student = await findStudent(externalId);
  if (!student) return Response.json({ error: "Student not found" }, { status: 404 });
  return Response.json({
    student: { id: student.externalId, name: student.name, grade: student.grade },
    arrived: !!student.arrivedAt,
    arrivedAt: student.arrivedAt,
    left: !!student.leftAt,
    leftAt: student.leftAt,
    status: student.arrivedAt ? (student.leftAt ? "left" : "in_school") : "not_arrived",
  });
}
