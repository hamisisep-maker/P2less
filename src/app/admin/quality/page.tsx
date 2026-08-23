import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminPermission } from "@/lib/admin-authz";
import { Card, PageHeader, Badge, timeAgo } from "@/components/ui";
import { QUALITY_CATEGORIES, TICKET_SOURCES, ACTION_DECISIONS } from "@/lib/quality-taxonomy";
import { RecruitPilotCard } from "./recruit-pilot-card";
import { TrainingSessionCard } from "./training-session-card";

const STATUS_TONE: Record<string, "rose" | "amber" | "indigo" | "green" | "neutral"> = {
  open: "rose", assigned: "amber", in_progress: "indigo", waiting_on_customer: "amber",
  resolved: "green", closed: "green", reopened: "rose",
};
const SOURCE_TONE: Record<string, "neutral" | "indigo" | "green"> = { internal: "neutral", tenant: "indigo", public_report: "green" };
function actionTone(value: string): "rose" | "green" | "indigo" {
  return value === "code_change" ? "rose" : value === "no_action" ? "green" : "indigo";
}

// Phase A of the Evidence & Assurance groundwork — see
// docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md. This is the "triage
// dashboard, grouped by category" Phase A commits to. Deliberately reuses
// the existing SupportTicket/tickets.view permission rather than a new
// system — a ticket only appears here once a reviewer sets its
// qualityCategory in the ticket workspace (setQualityCategoryAction).
export default async function AdminQualityPage() {
  await requireAdminPermission("tickets.view");

  const [tickets, tenants, activeSessionsRaw] = await Promise.all([
    db.supportTicket.findMany({
      where: { qualityCategory: { not: null } },
      include: { tenant: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.trainingSession.findMany({
      where: { status: "active" },
      include: {
        tenant: { select: { name: true, numbers: { where: { status: "active" }, select: { phoneNumber: true }, take: 1 } } },
        participants: { include: { contact: { select: { address: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const activeSessions = activeSessionsRaw.map((s) => ({
    id: s.id, tenantId: s.tenantId, tenantName: s.tenant.name, name: s.name, questionsPerParticipant: s.questionsPerParticipant, maxParticipants: s.maxParticipants, joinCode: s.joinCode,
    tenantWhatsAppNumber: s.tenant.numbers[0]?.phoneNumber ?? null,
    participantCount: s.participants.length, questionsUsed: s.participants.reduce((sum, p) => sum + p.questionCount, 0), createdAt: s.createdAt,
    participants: s.participants.map((p) => ({ address: p.contact.address, questionCount: p.questionCount })),
  }));

  const bySource = { internal: 0, tenant: 0, public_report: 0 } as Record<string, number>;
  for (const t of tickets) bySource[t.source] = (bySource[t.source] ?? 0) + 1;

  const groups = QUALITY_CATEGORIES.map((c) => ({ ...c, tickets: tickets.filter((t) => t.qualityCategory === c.value) }));

  // Answers a real question, not a decorative stat: "how many of the
  // problems we're finding actually require developers?" — every count
  // here is a live query result, never typed in (see docs/PUBLIC-FEEDBACK-
  // QUALITY-CENTRE-2026-08-23.md's "don't manufacture a score" rule).
  const decided = tickets.filter((t) => t.actionRequired);
  const byAction: Record<string, number> = {};
  for (const t of decided) if (t.actionRequired) byAction[t.actionRequired] = (byAction[t.actionRequired] ?? 0) + 1;
  const codeChangeCount = byAction["code_change"] ?? 0;
  const codeChangePct = decided.length ? Math.round((codeChangeCount / decided.length) * 100) : null;

  return (
    <div>
      <PageHeader
        title="Quality Centre"
        subtitle="Every ticket that's entered the AI-quality investigation waterfall, grouped by what the investigation actually found. Flag a ticket from its own page (Quality investigation panel) to bring it in here."
      />

      <TrainingSessionCard tenants={tenants} activeSessions={activeSessions} />

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

      <Card className="mb-4 p-5">
        <h2 className="mb-2 font-display font-semibold">Actions — how many of these actually need a developer?</h2>
        <p className="mb-3 text-xs text-muted">Root cause (above) and corrective action are separate decisions — a category never implies a fix layer. Set from a ticket&apos;s own Quality investigation panel, once classified, always with a stated reason.</p>
        {decided.length === 0 ? (
          <p className="text-sm text-muted">No action decisions recorded yet — {tickets.length} ticket{tickets.length === 1 ? "" : "s"} classified, {tickets.length} still awaiting an action decision.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {ACTION_DECISIONS.map((a) => (byAction[a.value] ?? 0) > 0 && (
                <div key={a.value} className="flex items-center gap-1.5">
                  <Badge tone={actionTone(a.value)}>{a.label}</Badge>
                  <span className="font-semibold tabular-nums">{byAction[a.value]}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-xs text-muted">
              <b className="tabular-nums">{codeChangePct}%</b> of decided findings ({codeChangeCount} of {decided.length}) required a code change — the rest were handled at a cheaper layer (knowledge, configuration, prompt, connector data, process, or needed nothing at all).
              {tickets.length > decided.length && <span> {tickets.length - decided.length} classified ticket{tickets.length - decided.length === 1 ? "" : "s"} still awaiting an action decision.</span>}
            </div>
          </>
        )}
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
                    {t.actionRequired ? (
                      <Badge tone={actionTone(t.actionRequired)}>{ACTION_DECISIONS.find((a) => a.value === t.actionRequired)?.label ?? t.actionRequired}</Badge>
                    ) : (
                      <Badge tone="neutral">action: not decided</Badge>
                    )}
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
