import { db } from "@/lib/db";
import { requireAdminPermission } from "@/lib/admin-authz";
import { Card, PageHeader } from "@/components/ui";
import { IncidentRow } from "./incident-row";
import { RunSweepButton } from "./run-sweep-button";

export default async function AdminIncidentsPage() {
  await requireAdminPermission("incidents.view");

  const [open, resolved] = await Promise.all([
    db.incident.findMany({ where: { status: { not: "resolved" } }, orderBy: [{ severity: "asc" }, { lastDetectedAt: "desc" }] }),
    db.incident.findMany({ where: { status: "resolved" }, orderBy: { resolvedAt: "desc" }, take: 20 }),
  ]);

  return (
    <div>
      <PageHeader
        title="Incidents"
        subtitle="Detected automatically by the incident sweep — nobody has to notice a red dashboard."
        action={<RunSweepButton />}
      />

      <Card className="p-5">
        <h2 className="mb-3 font-display font-semibold">Open ({open.length})</h2>
        {open.length === 0 && <p className="text-sm text-muted">No open incidents.</p>}
        <div className="space-y-2">
          {open.map((i) => (
            <IncidentRow
              key={i.id}
              data={{
                id: i.id, number: i.number, severity: i.severity, source: i.source, title: i.title, status: i.status,
                firstDetectedAt: i.firstDetectedAt, lastDetectedAt: i.lastDetectedAt, occurrenceCount: i.occurrenceCount,
                acknowledgedAt: i.acknowledgedAt, resolvedAt: i.resolvedAt, cause: i.cause, resolutionNote: i.resolutionNote,
                detail: i.detail,
              }}
            />
          ))}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Recently resolved</h2>
        {resolved.length === 0 && <p className="text-sm text-muted">Nothing resolved yet.</p>}
        <div className="space-y-2">
          {resolved.map((i) => (
            <IncidentRow
              key={i.id}
              data={{
                id: i.id, number: i.number, severity: i.severity, source: i.source, title: i.title, status: i.status,
                firstDetectedAt: i.firstDetectedAt, lastDetectedAt: i.lastDetectedAt, occurrenceCount: i.occurrenceCount,
                acknowledgedAt: i.acknowledgedAt, resolvedAt: i.resolvedAt, cause: i.cause, resolutionNote: i.resolutionNote,
                detail: i.detail,
              }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
