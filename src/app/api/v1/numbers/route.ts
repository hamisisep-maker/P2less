import { withApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

// GET /api/v1/numbers — the organization's registered WhatsApp numbers.
export async function GET(req: Request) {
  return withApiKey(req, "numbers.read", async (actor) => {
    const rows = await db.whatsAppNumber.findMany({ where: { tenantId: actor.tenantId }, orderBy: { createdAt: "asc" } });
    return Response.json({
      object: "list",
      data: rows.map((n) => ({
        id: n.id,
        phoneNumber: n.phoneNumber,
        displayName: n.displayName,
        department: n.department,
        status: n.status,
        verification: n.verificationStatus,
      })),
    });
  });
}
