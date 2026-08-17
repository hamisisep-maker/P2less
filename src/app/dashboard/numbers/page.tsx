import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";

export default async function NumbersPage() {
  const user = await requireTenantUser();
  const numbers = await db.whatsAppNumber.findMany({
    where: { tenantId: user.tenantId! },
    include: { _count: { select: { conversations: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <PageHeader
        title="WhatsApp Numbers"
        subtitle="Your organization's own numbers. Each is a routing front door — messages to it reach only your systems. Connect a Cloud API number, then assign capabilities."
      />
      <div className="space-y-3">
        {numbers.length === 0 && <Card className="p-6 text-sm text-muted">No numbers connected yet.</Card>}
        {numbers.map((n) => (
          <Card key={n.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-semibold">{n.phoneNumber}</span>
                  <Badge tone={n.status === "active" ? "green" : "neutral"}>{n.status}</Badge>
                  <Badge tone={n.verificationStatus === "verified" ? "accent" : "amber"}>{n.verificationStatus}</Badge>
                </div>
                <div className="mt-1 text-sm">{n.displayName}{n.department ? ` · ${n.department}` : ""}</div>
                <div className="mt-1 font-mono text-[11px] text-faint">phone_number_id: {n.phoneNumberId ?? "—"}</div>
              </div>
              <div className="text-right text-xs text-muted">
                <div>{n._count.conversations} conversation(s)</div>
                <div className="mt-1 text-faint">Users message this number directly.</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-faint">
        Connecting a real number uses the official WhatsApp Business Cloud API: register the number, set the
        webhook to <code>/api/channels/whatsapp/webhook</code>, and P2Less routes inbound messages to this tenant by <code>phone_number_id</code>.
      </p>
    </div>
  );
}
