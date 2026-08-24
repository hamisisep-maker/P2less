import { withTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";

const toneFor = (action: string, success: boolean): "green" | "rose" | "amber" | "neutral" => {
  if (!success) return "rose";
  if (action.startsWith("authz")) return "amber";
  return "green";
};

export default async function AuditPage() {
  return withTenantUser(async (user) => {
    // Real gap found 2026-08-23: ai.provider_failover is an internal AI-
    // reliability telemetry event (audit()'d with the tenant's real
    // tenantId by ai.ts's own failover logic), not something a tenant asked
    // for or should see — showing it here reveals P2Less's internal
    // multi-provider AI architecture on a page titled "audit log", which a
    // real customer would read as being about THEIR actions. Excluded by
    // name rather than filtering all actorType:"system" entries — billing.*
    // and notification.delivery_failed_terminal are also system-authored but
    // genuinely about the tenant's own account, so they stay visible.
    const logs = await db.auditLog.findMany({
      where: { tenantId: user.tenantId!, action: { not: "ai.provider_failover" } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Real gap found 2026-08-23 (asked directly, "the tenants should also see
    // the logs of his members"): the Actor column only ever showed the generic
    // actorType ("user"/"contact"/"system"), never WHICH staff member or
    // contact — accountability that means nothing once there's more than one
    // person on the account. actorId is a soft reference (no hard @relation,
    // same convention as relatedPaymentId elsewhere), so resolved here rather
    // than via an include.
    const userIds = [...new Set(logs.filter((l) => l.actorType === "user" && l.actorId).map((l) => l.actorId!))];
    const contactIds = [...new Set(logs.filter((l) => l.actorType === "contact" && l.actorId).map((l) => l.actorId!))];
    const [actorUsers, actorContacts] = await Promise.all([
      userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
      contactIds.length ? db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, displayName: true, address: true } }) : [],
    ]);
    const userNameById = new Map(actorUsers.map((u) => [u.id, u.name]));
    const contactNameById = new Map(actorContacts.map((c) => [c.id, c.displayName ?? c.address]));
    function actorLabel(l: (typeof logs)[number]): string {
      if (l.actorType === "user") return l.actorId ? (userNameById.get(l.actorId) ?? "Former staff member") : "Staff";
      if (l.actorType === "contact") return l.actorId ? (contactNameById.get(l.actorId) ?? "Former contact") : "Contact";
      return "System";
    }

    return (
      <div>
        <PageHeader title="Audit log" subtitle="Immutable record of every sensitive action. Secrets and PII are minimized by design." />
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Target</th>
                <th className="px-4 py-2.5">Actor</th>
                <th className="px-4 py-2.5">Result</th>
                <th className="px-4 py-2.5">Request</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-muted">No audit events yet.</td></tr>}
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-line-soft">
                  <td className="px-4 py-2.5 text-xs text-muted">{l.createdAt.toLocaleTimeString()}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{l.action}</td>
                  <td className="px-4 py-2.5 text-xs">{l.target ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{actorLabel(l)}</td>
                  <td className="px-4 py-2.5"><Badge tone={toneFor(l.action, l.success)}>{l.success ? "success" : "denied"}</Badge></td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-faint">{l.requestId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    );
  });
}
