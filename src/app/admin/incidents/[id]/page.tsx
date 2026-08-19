import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminPermission, hasAdminPermission } from "@/lib/admin-authz";
import { suggestRelatedTickets } from "@/lib/incident-detection";
import { Card, PageHeader, Badge, timeAgo } from "@/components/ui";
import { EvidencePanel } from "@/components/evidence-panel";
import { SuggestedTicketsPanel } from "./suggested-tickets-panel";

const SEVERITY_TONE: Record<string, "rose" | "amber" | "neutral"> = { critical: "rose", warning: "amber", info: "neutral" };
const STATUS_TONE: Record<string, "rose" | "amber" | "indigo" | "green"> = { detected: "rose", acknowledged: "amber", investigating: "indigo", resolved: "green" };

export default async function AdminIncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdminPermission("incidents.view");

  const incident = await db.incident.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } } } });
  if (!incident) notFound();

  const [suggested, confirmedTickets] = await Promise.all([
    suggestRelatedTickets(incident),
    db.supportTicket.findMany({ where: { relatedIncidentId: incident.id }, include: { tenant: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div>
      <PageHeader
        title={incident.number ?? incident.id.slice(0, 8)}
        subtitle={incident.title}
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_TONE[incident.severity] ?? "neutral"} dot>{incident.severity}</Badge>
          <Badge tone={STATUS_TONE[incident.status] ?? "neutral"}>{incident.status}</Badge>
          <span className="text-xs text-muted">{incident.source} · first detected {timeAgo(incident.firstDetectedAt)} · last seen {timeAgo(incident.lastDetectedAt)} · {incident.occurrenceCount} occurrence{incident.occurrenceCount === 1 ? "" : "s"}</span>
        </div>
        <EvidencePanel detail={incident.detail} />
        {incident.status === "resolved" && (
          <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <div><b>Cause:</b> {incident.cause}</div>
            <div><b>Resolution:</b> {incident.resolutionNote}</div>
          </div>
        )}

        <h3 className="mb-2 mt-5 text-sm font-semibold">Incident timeline</h3>
        <div className="space-y-1.5">
          {incident.events.map((e) => (
            <div key={e.id} className="rounded-lg border border-line-soft px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{e.type.replace(/_/g, " ")}</span>
                <span className="text-xs text-faint">{timeAgo(e.createdAt)}</span>
              </div>
              {e.note && <p className="mt-0.5 text-muted">{e.note}</p>}
              <EvidencePanel detail={e.detail} />
            </div>
          ))}
        </div>
      </Card>

      {confirmedTickets.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-3 font-display font-semibold">Confirmed related tickets ({confirmedTickets.length})</h2>
          <div className="space-y-1.5">
            {confirmedTickets.map((t) => (
              <Link key={t.id} href={`/admin/tickets/${t.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <span className="font-mono text-xs">{t.number ?? t.id.slice(0, 8)}</span>
                <span>{t.tenant.name}</span> · <span className="text-muted">{t.subject}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Suggested related tickets ({suggested.length})</h2>
        <p className="mb-3 text-xs text-muted">Created while this incident was open, in a matching category — a heuristic, never auto-linked. Confirm which are actually related.</p>
        {suggested.length === 0 && <p className="text-sm text-muted">No candidates found.</p>}
        <SuggestedTicketsPanel
          incidentIdentifier={incident.number ?? incident.id}
          tickets={suggested.map((t) => ({ id: t.id, number: t.number, tenantName: t.tenant.name, subject: t.subject, category: t.category, createdAt: t.createdAt }))}
          canLink={hasAdminPermission(admin, "tickets.manage")}
        />
      </Card>
    </div>
  );
}
