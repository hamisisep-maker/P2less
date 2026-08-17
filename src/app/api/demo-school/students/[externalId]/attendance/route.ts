import { checkDemoKey, unauthorized, findStudent } from "@/lib/demo-school";

export async function GET(req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (!checkDemoKey(req)) return unauthorized();
  const { externalId } = await params;
  const student = await findStudent(externalId);
  if (!student) return Response.json({ error: "Student not found" }, { status: 404 });
  const total = student.attendance.length;
  const present = student.attendance.filter((a) => a.status === "present").length;
  const late = student.attendance.filter((a) => a.status === "late").length;
  const absent = student.attendance.filter((a) => a.status === "absent").length;
  const rate = total ? Math.round((present / total) * 100) : 0;
  return Response.json({
    student: { id: student.externalId, name: student.name, grade: student.grade },
    present, late, absent, total, rate,
  });
}
