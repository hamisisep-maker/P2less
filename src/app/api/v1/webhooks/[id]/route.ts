import { withApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

// DELETE /api/v1/webhooks/{id} — remove a webhook endpoint. Scope: webhooks.write.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiKey(req, "webhooks.write", async (actor) => {
    const { id } = await params;
    const r = await db.webhook.deleteMany({ where: { id, tenantId: actor.tenantId } });
    if (r.count === 0) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ object: "webhook", id, deleted: true });
  });
}
