import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminPermission, hasAdminPermission } from "@/lib/admin-authz";
import { Card, PageHeader, Badge, timeAgo } from "@/components/ui";
import { NewTicketModal } from "./new-ticket-modal";

const PRIORITY_TONE: Record<string, "rose" | "amber" | "indigo" | "neutral"> = { urgent: "rose", high: "amber", normal: "indigo", low: "neutral" };
const STATUS_TONE: Record<string, "rose" | "amber" | "indigo" | "green" | "neutral"> = {
  open: "rose", assigned: "amber", in_progress: "indigo", waiting_on_customer: "amber",
  resolved: "green", closed: "green", reopened: "rose",
};

export default async function AdminTicketsPage() {
  const admin = await requireAdminPermission("tickets.view");
  const canCreate = hasAdminPermission(admin, "tickets.manage");

  const [open, resolved, tenants] = await Promise.all([
    db.supportTicket.findMany({
      where: { status: { notIn: ["resolved", "closed"] } },
      include: { tenant: { select: { name: true } }, assignedAdmin: { select: { name: true } } },
      orderBy: [{ slaBreached: "desc" }, { createdAt: "desc" }],
    }),
    db.supportTicket.findMany({
      where: { status: { in: ["resolved", "closed"] } },
      include: { tenant: { select: { name: true } }, assignedAdmin: { select: { name: true } } },
      orderBy: { resolvedAt: "desc" },
      take: 20,
    }),
    db.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // "Every owner must have an actionable queue" — real gap found while
  // checking the ownership/communication-flow proposal, 2026-08-23: nothing
  // distinguished "assigned to me" from the flat list of every open ticket.
  const mine = open.filter((t) => t.assignedAdminId === admin.id);
  const unassigned = open.filter((t) => !t.assignedAdminId);

  const Row = ({ t }: { t: (typeof open)[number] }) => (
    <Link href={`/admin/tickets/${t.id}`} className="block rounded-xl border border-line-soft px-3.5 py-3 hover:bg-surface-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-faint">{t.number ?? t.id.slice(0, 8)}</span>
          <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status.replace(/_/g, " ")}</Badge>
          <Badge tone={PRIORITY_TONE[t.priority] ?? "neutral"} dot>{t.priority}</Badge>
          {t.qualityCategory && <Badge tone="amber">Quality</Badge>}
          {t.slaBreached && <Badge tone="rose">SLA breached</Badge>}
          <span className="font-medium">{t.subject}</span>
        </div>
        <span className="text-xs text-muted">{timeAgo(t.createdAt)}</span>
      </div>
      <div className="mt-1.5 text-xs text-muted">
        {t.tenant.name} · {t.category} · {t.assignedAdmin ? `assigned to ${t.assignedAdmin.name}` : "unassigned"}
      </div>
    </Link>
  );

  return (
    <div>
      <PageHeader
        title="Support Tickets"
        subtitle="A customer reporting a problem — distinct from an Incident (something wrong with the platform). Open a ticket to see everything the platform already knows about that tenant."
        action={canCreate ? <NewTicketModal tenants={tenants} /> : undefined}
      />

      {mine.length > 0 && (
        <Card className="mb-4 border-accent/30 bg-accent-soft/10 p-5">
          <h2 className="mb-3 font-display font-semibold">My queue ({mine.length})</h2>
          <div className="space-y-2">{mine.map((t) => <Row key={t.id} t={t} />)}</div>
        </Card>
      )}

      {unassigned.length > 0 && (
        <Card className="mb-4 p-5">
          <h2 className="mb-3 font-display font-semibold">Unassigned ({unassigned.length})</h2>
          <p className="mb-2 text-xs text-muted">Nobody owns these yet — the actionable-queue gap this fixes only helps once someone actually claims them.</p>
          <div className="space-y-2">{unassigned.map((t) => <Row key={t.id} t={t} />)}</div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-3 font-display font-semibold">Open ({open.length})</h2>
        {open.length === 0 && <p className="text-sm text-muted">No open tickets.</p>}
        <div className="space-y-2">{open.map((t) => <Row key={t.id} t={t} />)}</div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Recently resolved</h2>
        {resolved.length === 0 && <p className="text-sm text-muted">Nothing resolved yet.</p>}
        <div className="space-y-2">{resolved.map((t) => <Row key={t.id} t={t} />)}</div>
      </Card>
    </div>
  );
}
