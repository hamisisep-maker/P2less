import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";

export default async function ConversationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireTenantUser();
  const convo = await db.conversation.findFirst({
    where: { id, tenantId: user.tenantId! }, // tenant-scoped: no cross-tenant reads
    include: { contact: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!convo) notFound();

  return (
    <div>
      <PageHeader
        title={convo.contact.displayName ?? convo.contact.address}
        subtitle={`${convo.contact.channelType} · ${convo.messages.length} messages`}
        action={<Badge tone={convo.status === "escalated" ? "amber" : "neutral"}>{convo.status}</Badge>}
      />
      <Card className="space-y-2 p-5">
        {convo.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "in" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${m.direction === "in" ? "bg-accent-soft" : "bg-surface-2"}`}>
              {m.body}
              <div className="mt-1 text-[10px] text-faint">{m.createdAt.toLocaleTimeString()}</div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
