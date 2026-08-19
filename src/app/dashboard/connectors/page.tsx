import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";

export default async function ConnectorsPage() {
  const user = await requireTenantUser();
  const connectors = await db.connector.findMany({
    where: { tenantId: user.tenantId! },
    include: { actions: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="Connect external systems and expose them as conversational capabilities."
        action={
          <div className="flex items-center gap-2">
            <Link href="/dashboard/connectors/import" className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-surface-2">Import from OpenAPI</Link>
            <Link href="/dashboard/connectors/new" className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5">New connector</Link>
          </div>
        }
      />
      <div className="space-y-4">
        {connectors.length === 0 && <Card className="p-6 text-sm text-muted">No connectors yet.</Card>}
        {connectors.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display font-semibold">{c.name}</h2>
                  <Badge tone={c.status === "active" ? "green" : "neutral"}>{c.status}</Badge>
                  <Badge tone="accent">{c.authType}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted">{c.description}</div>
                <div className="mt-1 font-mono text-xs text-faint">{c.baseUrl}</div>
              </div>
              <Badge tone={c.lastOk === false ? "rose" : c.lastOk ? "green" : "neutral"}>
                {c.lastOk === false ? "last call failed" : c.lastOk ? "healthy" : "untested"}
              </Badge>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-faint">
                    <th className="py-1.5 pr-3">Capability</th>
                    <th className="py-1.5 pr-3">Method</th>
                    <th className="py-1.5 pr-3">Path</th>
                    <th className="py-1.5 pr-3">Permission</th>
                    <th className="py-1.5">Step-up</th>
                  </tr>
                </thead>
                <tbody>
                  {c.actions.map((a) => (
                    <tr key={a.id} className="border-t border-line-soft">
                      <td className="py-2 pr-3"><div className="font-medium">{a.name}</div><div className="font-mono text-[11px] text-faint">{a.key}</div></td>
                      <td className="py-2 pr-3"><Badge>{a.method}</Badge></td>
                      <td className="py-2 pr-3 font-mono text-xs">{a.path}</td>
                      <td className="py-2 pr-3 text-xs text-muted">{a.requiredPermission ?? "—"}</td>
                      <td className="py-2">{a.requiresStepUp ? <Badge tone="amber">OTP</Badge> : <span className="text-xs text-faint">no</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
