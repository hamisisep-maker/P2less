import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";

export default async function ConversationsPage() {
  const user = await requireTenantUser();
  const conversations = await db.conversation.findMany({
    where: { tenantId: user.tenantId! },
    orderBy: { updatedAt: "desc" },
    include: { contact: true, _count: { select: { messages: true } } },
    take: 50,
  });

  return (
    <div>
      <PageHeader title="Conversations" subtitle="Every conversation across all channels, subject to your data policies." />
      <Card className="divide-y divide-line-soft">
        {conversations.length === 0 && <div className="p-6 text-sm text-muted">No conversations yet.</div>}
        {conversations.map((c) => (
          <Link key={c.id} href={`/dashboard/conversations/${c.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-surface-2">
            <div>
              <div className="text-sm font-medium">{c.contact.displayName ?? c.contact.address}</div>
              <div className="text-xs text-muted">{c._count.messages} messages · {c.contact.channelType} · updated {c.updatedAt.toLocaleString()}</div>
            </div>
            <Badge tone={c.status === "escalated" ? "amber" : c.status === "awaiting_otp" ? "accent" : "neutral"}>{c.status}</Badge>
          </Link>
        ))}
      </Card>
    </div>
  );
}
