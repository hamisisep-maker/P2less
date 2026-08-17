import { requireKey, unauthorized } from "@/lib/demo-auth";
import { db } from "@/lib/db";

// DEMO EXTERNAL SYSTEM: Nairobi Hospital patient management.
export async function GET(req: Request, { params }: { params: Promise<{ patientId: string }> }) {
  if (!requireKey(req, process.env.DEMO_HOSPITAL_API_KEY || "")) return unauthorized();
  const { patientId } = await params;
  const patient = await db.demoPatient.findUnique({ where: { externalId: patientId } });
  if (!patient) return Response.json({ error: "Patient not found" }, { status: 404 });
  return Response.json({
    patient: { id: patient.externalId, name: patient.name },
    hasAppointment: !!patient.nextApptDate,
    date: patient.nextApptDate,
    time: patient.nextApptTime,
    department: patient.nextApptDept,
  });
}
