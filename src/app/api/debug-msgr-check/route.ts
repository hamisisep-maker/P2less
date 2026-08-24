import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Temporary — deleted right after use. Checks whether a real inbound
// Messenger message landed for Hamzone Technologies' connected Page in the
// last hour, and whether a reply was sent back.
export async function GET() {
  const tenant = await db.tenant.findFirst({ where: { slug: "hamzone" } });
  if (!tenant) return NextResponse.json({ error: "hamzone tenant not found" }, { status: 500 });

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.message.findMany({
    where: { tenantId: tenant.id, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    include: { conversation: { include: { contact: true } } },
  });

  const messengerMessages = recent.filter((m) => m.conversation.contact.channelType === "messenger");

  return NextResponse.json({
    checkedSince: since.toISOString(),
    totalRecentMessagesAllChannels: recent.length,
    messengerMessageCount: messengerMessages.length,
    messenger: messengerMessages.map((m) => ({
      direction: m.direction,
      body: m.body.slice(0, 150),
      contactAddress: m.conversation.contact?.address,
      createdAt: m.createdAt,
    })),
  });
}
