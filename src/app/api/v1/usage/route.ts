import { withApiKey } from "@/lib/api-auth";
import { monthlyUsage } from "@/lib/usage";

// GET /api/v1/usage — this month's metered usage for the tenant.
export async function GET(req: Request) {
  return withApiKey(req, "usage.read", async (actor) => {
    const [messagesIn, messagesOut, aiRequests, documents] = await Promise.all([
      monthlyUsage(actor.tenantId, "message_in"),
      monthlyUsage(actor.tenantId, "message_out"),
      monthlyUsage(actor.tenantId, "ai_request"),
      monthlyUsage(actor.tenantId, "document"),
    ]);
    return Response.json({
      object: "usage",
      period: new Date().toISOString().slice(0, 7),
      messagesIn,
      messagesOut,
      aiRequests,
      documents,
    });
  });
}
