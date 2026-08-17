import { requireKey, unauthorized } from "@/lib/demo-auth";
import { db } from "@/lib/db";

const digits = (s: string) => s.replace(/[^\d]/g, "");

// Self-service identity check: does this Employee ID belong to someone whose
// phone number the payroll system has on file? Used by P2Less to safely link a
// new WhatsApp contact to their own employee record (never reveals other data).
export async function POST(req: Request) {
  if (!requireKey(req, process.env.DEMO_PAYROLL_API_KEY || "")) return unauthorized();
  let body: { id?: string; phone?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = (body.id ?? "").trim().toUpperCase();
  const phone = digits(body.phone ?? "");
  const employee = await db.demoEmployee.findUnique({ where: { externalId: id } });
  const onFile = ((employee?.phones as string[] | undefined) ?? []).map(digits);
  const matched = !!employee && !!phone && onFile.includes(phone);
  return Response.json({
    matched,
    id: matched ? employee!.externalId : null,
    name: matched ? employee!.name : null,
  });
}
