import { requireAdminPermission } from "@/lib/admin-authz";
import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { AdminConversationsTable, type AdminConvoRow } from "@/components/dashboard-ui";

// Real gap found 2026-08-23 (asked directly, "search field... in
// conversations in both tenants and admins"): no admin-wide conversation
// view existed at all before this — an admin investigating "what's actually
// happening across the platform right now" had no page to go to, only
// per-tenant operational summaries. Capped at 200, most recent first — a
// real cap for a v1 cross-tenant view, not a placeholder; a platform-wide
// date-range/filter query is real future scope once this proves useful.
export default async function AdminConversationsPage() {
  await requireAdminPermission("tenants.view");

  const conversations = await db.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { contact: true, tenant: { select: { id: true, name: true } }, _count: { select: { messages: true } } },
  });

  const rows: AdminConvoRow[] = conversations.map((c) => ({
    id: c.id,
    tenantId: c.tenant.id,
    tenantName: c.tenant.name,
    name: c.contact.displayName ?? c.contact.address,
    channel: c.contact.channelType,
    messages: c._count.messages,
    status: c.status,
    updated: c.updatedAt,
  }));

  return (
    <div>
      <PageHeader title="Conversations" subtitle="Every conversation across every tenant, most recently active first." />
      <Card className="p-5">
        <AdminConversationsTable data={rows} />
      </Card>
    </div>
  );
}
