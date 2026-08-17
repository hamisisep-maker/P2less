import { withApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

// GET /api/v1/webhooks — list the org's webhook endpoints. Scope: webhooks.write.
export async function GET(req: Request) {
  return withApiKey(req, "webhooks.write", async (actor) => {
    const rows = await db.webhook.findMany({ where: { tenantId: actor.tenantId }, orderBy: { createdAt: "desc" } });
    return Response.json({ object: "list", data: rows.map((h) => ({ id: h.id, url: h.url, events: h.events, active: h.active })) });
  });
}

// POST /api/v1/webhooks — register an endpoint. body: { url, events: string[] }.
export async function POST(req: Request) {
  return withApiKey(req, "webhooks.write", async (actor) => {
    let body: { url?: string; events?: string[] };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    if (!body.url || !/^https?:\/\/.+/.test(body.url)) {
      return Response.json({ error: "invalid_request", message: "A valid https 'url' is required." }, { status: 400 });
    }
    const events = (body.events ?? []).filter((e) => e === "*" || (WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (events.length === 0) {
      return Response.json({ error: "invalid_request", message: `Provide at least one of: ${WEBHOOK_EVENTS.join(", ")} (or "*").` }, { status: 400 });
    }
    const secret = "whsec_" + randomToken(16);
    const wh = await db.webhook.create({ data: { tenantId: actor.tenantId, url: body.url, secret, events, active: true } });
    return Response.json({ object: "webhook", id: wh.id, url: wh.url, events, secret }, { status: 201 });
  });
}
