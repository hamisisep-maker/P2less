import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// ?fix=1 removes the ONE specific, confirmed-wrong Channel row: Riverside
// Academy's messenger channel bound to the real Hamzone Technologies LTD
// Page (828105030394804) — precisely scoped by tenantId+type+address, not
// a broad delete.
async function applyFix(): Promise<{ deleted: number }> {
  const riverside = await db.tenant.findFirst({ where: { slug: "riverside" } });
  if (!riverside) return { deleted: 0 };
  const result = await db.channel.deleteMany({
    where: { tenantId: riverside.id, type: "messenger", address: "828105030394804" },
  });
  return { deleted: result.count };
}

// Temporary — deleted right after use. Investigating a real, unexpected
// finding: a message sent to what the user believes is the Hamzone
// Technologies Facebook Page got a reply as Riverside Academy instead.
// Checks (1) every messenger-type Channel row across every tenant, to look
// for a duplicate/colliding Page id, and (2) recent messages across every
// tenant, not just Hamzone.
export async function GET(req: Request) {
  const shouldFix = new URL(req.url).searchParams.get("fix") === "1";
  const fixResult = shouldFix ? await applyFix() : null;

  const messengerChannels = await db.channel.findMany({
    where: { type: "messenger" },
    include: { tenant: { select: { name: true, slug: true } } },
  });

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.message.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    include: { conversation: { include: { contact: true, tenant: { select: { name: true, slug: true } } } } },
  });
  const messengerMessages = recent.filter((m) => m.conversation.contact.channelType === "messenger");

  return NextResponse.json({
    fixResult,
    messengerChannels: messengerChannels.map((c) => ({
      tenant: c.tenant.name,
      slug: c.tenant.slug,
      pageId: c.address,
      status: c.status,
      pageName: (c.config as { pageName?: string } | null)?.pageName,
    })),
    checkedSince: since.toISOString(),
    messengerMessages: messengerMessages.map((m) => ({
      tenant: m.conversation.tenant.name,
      direction: m.direction,
      body: m.body.slice(0, 150),
      contactAddress: m.conversation.contact?.address,
      createdAt: m.createdAt,
    })),
  });
}
