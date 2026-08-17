import { withApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { deliver } from "@/lib/transport";

// POST /api/v1/messages — send an outbound message from one of the org's numbers
// to a recipient. Scope: messages.write.
//   body: { from: "<org number>", to: "<recipient>", text: "..." }
//
// Note: business-INITIATED WhatsApp messages outside the 24-hour customer-service
// window require an approved template; free-form text works within it.
export async function POST(req: Request) {
  return withApiKey(req, "messages.write", async (actor) => {
    let body: { from?: string; to?: string; text?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    if (!body.from || !body.to || !body.text) {
      return Response.json({ error: "invalid_request", message: "from, to and text are required." }, { status: 400 });
    }
    const norm = (p: string) => (p.trim().startsWith("+") ? "+" + p.replace(/[^\d]/g, "") : p.replace(/[^\d]/g, "").length >= 7 ? "+" + p.replace(/[^\d]/g, "") : p.trim());

    const number = await db.whatsAppNumber.findFirst({ where: { tenantId: actor.tenantId, phoneNumber: norm(body.from) } });
    if (!number) {
      return Response.json({ error: "number_not_found", message: "That 'from' number is not registered to your organization." }, { status: 404 });
    }
    const address = norm(body.to);
    const contact = await db.contact.upsert({
      where: { tenantId_channelType_address: { tenantId: actor.tenantId, channelType: "whatsapp", address } },
      create: { tenantId: actor.tenantId, channelType: "whatsapp", address },
      update: {},
    });
    let convo = await db.conversation.findFirst({ where: { tenantId: actor.tenantId, contactId: contact.id, numberId: number.id, status: { not: "closed" } }, orderBy: { updatedAt: "desc" } });
    if (!convo) convo = await db.conversation.create({ data: { tenantId: actor.tenantId, contactId: contact.id, numberId: number.id, status: "open", context: {} } });

    const result = await deliver({ tenantId: actor.tenantId, conversationId: convo.id, channelType: "whatsapp", to: address, body: body.text, fromNumberId: number.phoneNumberId });
    return Response.json({ object: "message", conversationId: convo.id, to: address, delivered: result.delivered, transport: result.transport, error: result.error ?? null }, { status: result.delivered ? 201 : 202 });
  });
}
