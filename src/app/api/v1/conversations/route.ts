import { withApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

// GET /api/v1/conversations — list this tenant's conversations. Scope: read.
export async function GET(req: Request) {
  return withApiKey(req, "conversations.read", async (actor) => {
    const url = new URL(req.url);
    const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 25));
    const rows = await db.conversation.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: { contact: true, number: true, _count: { select: { messages: true } } },
    });
    return Response.json({
      object: "list",
      data: rows.map((c) => ({
        id: c.id,
        status: c.status,
        contact: { address: c.contact.address, name: c.contact.displayName },
        number: c.number?.phoneNumber ?? null,
        messages: c._count.messages,
        updated: c.updatedAt.toISOString(),
      })),
    });
  });
}
