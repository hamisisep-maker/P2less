import { checkDemoKey, unauthorized } from "@/lib/demo-school";
import { db } from "@/lib/db";

const digits = (s: string) => s.replace(/[^\d]/g, "");

// Self-service identity check for a parent: does this student's admission number
// belong to a student whose guardian phone the school has on file? Lets P2Less
// link a new parent WhatsApp contact to their own child's record.
export async function POST(req: Request) {
  if (!checkDemoKey(req)) return unauthorized();
  let body: { id?: string; phone?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = (body.id ?? "").trim().toUpperCase();
  const phone = digits(body.phone ?? "");
  const student = await db.demoStudent.findUnique({ where: { externalId: id } });
  const onFile = ((student?.parentPhones as string[] | undefined) ?? []).map(digits);
  const matched = !!student && !!phone && onFile.includes(phone);
  return Response.json({
    matched,
    id: matched ? student!.externalId : null,
    name: matched ? student!.name : null,
    grade: matched ? student!.grade : null,
  });
}
