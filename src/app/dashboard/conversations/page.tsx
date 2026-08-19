import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { ConversationsTable, type ConvoRow } from "@/components/dashboard-ui";

export default async function ConversationsPage() {
  const user = await requireTenantUser();
  const conversations = await db.conversation.findMany({
    where: { tenantId: user.tenantId! },
    orderBy: { updatedAt: "desc" },
    include: { contact: true, _count: { select: { messages: true } } },
    take: 100,
  });

  const rows: ConvoRow[] = conversations.map((c) => ({
    id: c.id,
    name: c.contact.displayName ?? c.contact.address,
    channel: c.contact.channelType,
    messages: c._count.messages,
    status: c.status,
    updated: c.updatedAt,
  }));

  return (
    <div>
      <PageHeader title="Conversations" subtitle="Every conversation across all channels, subject to your data policies." />
      <Card className="p-5">
        <ConversationsTable data={rows} pageSize={12} />
      </Card>
    </div>
  );
}
