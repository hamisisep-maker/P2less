"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, Search } from "lucide-react";
import { Badge, timeAgo } from "@/components/ui";
import { EvidencePanel } from "@/components/evidence-panel";
import { acknowledgeIncidentAction, startInvestigatingIncidentAction } from "@/lib/incident-actions";
import { ResolveModal } from "./resolve-modal";

export type IncidentRowData = {
  id: string; number: string | null; severity: string; source: string; title: string; status: string;
  firstDetectedAt: Date; lastDetectedAt: Date; occurrenceCount: number;
  acknowledgedAt: Date | null; resolvedAt: Date | null; cause: string | null; resolutionNote: string | null;
  detail?: unknown;
};

const SEVERITY_TONE: Record<string, "rose" | "amber" | "neutral"> = { critical: "rose", warning: "amber", info: "neutral" };
const STATUS_TONE: Record<string, "rose" | "amber" | "indigo" | "green"> = { detected: "rose", acknowledged: "amber", investigating: "indigo", resolved: "green" };

export function IncidentRow({ data }: { data: IncidentRowData }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-line-soft px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_TONE[data.severity] ?? "neutral"} dot>{data.severity}</Badge>
          <Badge tone={STATUS_TONE[data.status] ?? "neutral"}>{data.status}</Badge>
          <Link href={`/admin/incidents/${data.id}`} className="font-medium hover:underline">
            {data.number && <span className="mr-1.5 font-mono text-xs text-faint">{data.number}</span>}
            {data.title}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {data.status === "detected" && (
            <button
              disabled={pending}
              onClick={() => startTransition(async () => {
                const res = await acknowledgeIncidentAction(data.id);
                if ("error" in res && res.error) { toast.error(res.error); return; }
                toast.success("Acknowledged");
              })}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2"
            >
              <Eye size={12} /> Acknowledge
            </button>
          )}
          {(data.status === "detected" || data.status === "acknowledged") && (
            <button
              disabled={pending}
              onClick={() => startTransition(async () => {
                const res = await startInvestigatingIncidentAction(data.id);
                if ("error" in res && res.error) { toast.error(res.error); return; }
                toast.success("Marked as investigating");
              })}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2"
            >
              <Search size={12} /> Investigate
            </button>
          )}
          {data.status !== "resolved" && <ResolveModal incidentId={data.id} />}
        </div>
      </div>
      <div className="mt-1.5 text-xs text-muted">
        {data.source} · first detected <span suppressHydrationWarning>{timeAgo(data.firstDetectedAt)}</span> · last seen <span suppressHydrationWarning>{timeAgo(data.lastDetectedAt)}</span> · {data.occurrenceCount} occurrence{data.occurrenceCount === 1 ? "" : "s"}
      </div>
      <EvidencePanel detail={data.detail} />
      {data.status === "resolved" && (
        <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
          <div><b>Cause:</b> {data.cause}</div>
          <div><b>Resolution:</b> {data.resolutionNote}</div>
          {data.resolvedAt && <div className="mt-0.5 text-faint" suppressHydrationWarning>Resolved {timeAgo(data.resolvedAt)}</div>}
        </div>
      )}
    </div>
  );
}
