import { withApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

// GET /api/v1/capabilities — the conversational capabilities (connector actions)
// exposed by this organization's connected systems.
export async function GET(req: Request) {
  return withApiKey(req, "capabilities.read", async (actor) => {
    const connectors = await db.connector.findMany({
      where: { tenantId: actor.tenantId },
      include: { actions: { where: { enabled: true, key: { not: "IDENTIFY" } } } },
      orderBy: { createdAt: "asc" },
    });
    return Response.json({
      object: "list",
      data: connectors.map((c) => ({
        connector: c.name,
        status: c.status,
        capabilities: c.actions.map((a) => ({
          key: a.key,
          name: a.name,
          operation: a.operation,
          requiresVerification: a.requiresStepUp,
          requiresConfirmation: a.requiresConfirm,
        })),
      })),
    });
  });
}
