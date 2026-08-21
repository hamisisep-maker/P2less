// TEMPORARY — checks whether any real Messenger message has ever reached
// the webhook (a Contact with channelType "messenger" implies handleInbound()
// ran for one). Removed after use.
import { db } from "@/lib/db";

export async function GET() {
  const contacts = await db.contact.findMany({
    where: { channelType: "messenger" },
    include: { conversations: { include: { messages: { orderBy: { createdAt: "desc" }, take: 5 } }, orderBy: { updatedAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  });

  const recentInboundEvents = await db.inboundEvent.findMany({
    where: { source: "messenger_webhook" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return Response.json({ messengerContacts: contacts, recentInboundEvents });
}
