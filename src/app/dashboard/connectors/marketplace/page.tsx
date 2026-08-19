import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import type { DraftAction } from "@/lib/openapi-import";

export default async function MarketplacePage() {
  await requireTenantUser();
  const templates = await db.connectorTemplate.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <div>
      <PageHeader title="Marketplace" subtitle="Platform-curated starter connectors — install one, point it at your own system, and review every capability before it goes live." />
      <div className="grid gap-4 sm:grid-cols-2">
        {templates.length === 0 && <Card className="p-6 text-sm text-muted">No templates published yet.</Card>}
        {templates.map((t) => {
          const actions = t.actions as unknown as DraftAction[];
          return (
            <Card key={t.id} className="flex flex-col gap-3 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display font-semibold">{t.name}</h2>
                  <Badge tone="accent">{t.category}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{t.description}</p>
              </div>
              <div className="text-xs text-faint">{actions.length} capabilit{actions.length === 1 ? "y" : "ies"}: {actions.map((a) => a.name).join(", ")}</div>
              <Link
                href={`/dashboard/connectors/marketplace/${t.key}`}
                className="mt-auto self-start rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5"
              >
                Install
              </Link>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
