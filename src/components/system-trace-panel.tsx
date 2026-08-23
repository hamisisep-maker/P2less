"use client";

import { Badge, timeAgo } from "@/components/ui";
import { EvidencePanel } from "@/components/evidence-panel";

type AuditRow = { id: string; action: string; target: string | null; success: boolean; detail: unknown; createdAt: Date };
type AiRow = { id: string; provider: string; model: string; feature: string; costKes: number; totalTokens: number | null; success: boolean; createdAt: Date };

const ACTION_LABELS: Record<string, string> = {
  "otp.issue": "OTP issued", "otp.verify": "OTP verified", "contact.link": "Contact linked",
  "authz.deny": "Authorization denied", "connector.execute": "Connector executed", "escalate": "Escalated to human",
};

/** Point #8 from the visualization proposal, docs/OPERATIONS-GUIDE-2026-08-23.md
 *  — the single highest-leverage view: what did the system actually do for
 *  ONE message. Built from data that already existed (AuditLog/AiRequestLog,
 *  both keyed by requestId) — the only new piece was Message.requestId
 *  itself, so this is real, not a mockup. Only ever has rows for messages
 *  created after 2026-08-23 (when requestId started being recorded) — older
 *  messages honestly show "no trace available", never a fabricated one. */
export function SystemTracePanel({ auditRows, aiRows }: { auditRows: AuditRow[]; aiRows: AiRow[] }) {
  if (auditRows.length === 0 && aiRows.length === 0) {
    return <p className="text-xs text-faint">No system trace available for this message — either it predates trace recording, or nothing auditable happened while handling it.</p>;
  }
  type Step = { id: string; time: Date; label: string; success: boolean; body: React.ReactNode };
  const steps: Step[] = [
    ...auditRows.map((a) => ({
      id: a.id, time: a.createdAt, label: ACTION_LABELS[a.action] ?? a.action, success: a.success,
      body: <>{a.target && <span className="text-xs text-faint">target: {a.target}</span>}<EvidencePanel detail={a.detail} /></>,
    })),
    ...aiRows.map((r) => ({
      id: r.id, time: r.createdAt, label: `AI request — ${r.feature.replace(/_/g, " ")}`, success: r.success,
      body: <span className="text-xs text-faint">{r.provider}/{r.model} · {r.totalTokens ?? "?"} tokens · KES {r.costKes.toFixed(3)}</span>,
    })),
  ].sort((a, b) => a.time.getTime() - b.time.getTime());

  return (
    <div className="space-y-1.5">
      {steps.map((s) => (
        <div key={s.id} className="flex items-start gap-2 rounded-lg border border-line-soft px-3 py-2 text-sm">
          <Badge tone={s.success ? "green" : "rose"}>{s.success ? "ok" : "failed"}</Badge>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{s.label}</span>
              <span className="text-xs text-faint" suppressHydrationWarning>{timeAgo(s.time)}</span>
            </div>
            {s.body}
          </div>
        </div>
      ))}
    </div>
  );
}
