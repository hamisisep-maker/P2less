import { checkDemoKey, unauthorized, findStudent } from "@/lib/demo-school";

export async function GET(req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (!checkDemoKey(req)) return unauthorized();
  const { externalId } = await params;
  const student = await findStudent(externalId);
  if (!student) return Response.json({ error: "Student not found" }, { status: 404 });
  const results = student.results.map((r) => ({ term: r.term, subject: r.subject, score: r.score, grade: r.grade }));
  const average = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;
  const summary = results.map((r) => `${r.subject} ${r.score}`).join(", ");
  return Response.json({
    student: { id: student.externalId, name: student.name, grade: student.grade },
    results,
    average,
    summary,
  });
}
