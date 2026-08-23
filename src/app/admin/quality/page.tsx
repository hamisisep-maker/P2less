import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminPermission } from "@/lib/admin-authz";
import { Card, PageHeader, Badge, timeAgo } from "@/components/ui";
import { QUALITY_CATEGORIES, TICKET_SOURCES } from "@/lib/quality-taxonomy";
import { RecruitPilotCard } from "./recruit-pilot-card";

const STATUS_TONE: Record<string, "rose" | "amber" | "indigo" | "green" | "neutral"> = {
  open: "rose", assigned: "amber", in_progress: "indigo", waiting_on_customer: "amber",
  resolved: "green", closed: "green", reopened: "rose",
};
const SOURCE_TONE: Record<string, "neutral" | "indigo" | "green"> = { internal: "neutral", tenant: "indigo", public_report: "green" };

// Phase A of the Evidence & Assurance groundwork — see
// docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md. This is the "triage
// dashboard, grouped by category" Phase A commits to. Deliberately reuses
// the existing SupportTicket/tickets.view permission rather than a new
// system — a ticket only appears here once a reviewer sets its
// qualityCategory in the ticket workspace (setQualityCategoryAction).
export default async function AdminQualityPage() {
  await requireAdminPermission("tickets.view");

  const tickets = await db.supportTicket.findMany({
    where: { qualityCategory: { not: null } },
    include: { tenant: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const bySource = { internal: 0, tenant: 0, public_report: 0 } as Record<string, number>;
  for (const t of tickets) bySource[t.source] = (bySource[t.source] ?? 0) + 1;

  const groups = QUALITY_CATEGORIES.map((c) => ({ ...c, tickets: tickets.filter((t) => t.qualityCategory === c.value) }));

  return (
    <div>
      <PageHeader
        title="Quality Centre"
        subtitle="Every ticket that's entered the AI-quality investigation waterfall, grouped by what the investigation actually found. Flag a ticket from its own page (Quality investigation panel) to bring it in here."
      />

      <RecruitPilotCard />

      <Card className="mb-4 p-5">
        <h2 className="mb-2 font-display font-semibold">Origin, this pilot</h2>
        <p className="mb-3 text-xs text-muted">Chat is evidence, not the assurance layer itself — this is a count of raw reports, not verified findings.</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {TICKET_SOURCES.map((s) => (
            <div key={s.value} className="flex items-center gap-1.5">
              <Badge tone={SOURCE_TONE[s.value] ?? "neutral"} dot>{s.label.split(" — ")[0]}</Badge>
              <span className="font-semibold tabular-nums">{bySource[s.value] ?? 0}</span>
            </div>
          ))}
          <div className="ml-auto text-xs text-faint">{tickets.length} total in the quality pipeline</div>
        </div>
      </Card>

      {groups.map((g) => (
        <Card key={g.value} className="mb-4 p-5">
          <h2 className="mb-3 font-display font-semibold">{g.label} ({g.tickets.length})</h2>
          {g.tickets.length === 0 && <p className="text-sm text-muted">Nothing in this category yet.</p>}
          <div className="space-y-2">
            {g.tickets.map((t) => (
              <Link key={t.id} href={`/admin/tickets/${t.id}`} className="block rounded-xl border border-line-soft px-3.5 py-3 hover:bg-surface-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-faint">{t.number ?? t.id.slice(0, 8)}</span>
                    <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status.replace(/_/g, " ")}</Badge>
                    <Badge tone={SOURCE_TONE[t.source] ?? "neutral"} dot>{TICKET_SOURCES.find((s) => s.value === t.source)?.label.split(" — ")[0] ?? t.source}</Badge>
                    <span className="font-medium">{t.subject}</span>
                  </div>
                  <span className="text-xs text-muted" suppressHydrationWarning>{timeAgo(t.createdAt)}</span>
                </div>
                <div className="mt-1.5 text-xs text-muted">{t.tenant.name}</div>
              </Link>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
