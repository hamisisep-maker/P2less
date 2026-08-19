"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Eye, Search } from "lucide-react";
import { Badge, timeAgo } from "@/components/ui";
import { acknowledgeIncidentAction, startInvestigatingIncidentAction } from "@/lib/incident-actions";
import { ResolveModal } from "./resolve-modal";

export type IncidentRowData = {
  id: string; severity: string; source: string; title: string; status: string;
  firstDetectedAt: Date; lastDetectedAt: Date; occurrenceCount: number;
  acknowledgedAt: Date | null; resolvedAt: Date | null; cause: string | null; resolutionNote: string | null;
  detail?: unknown;
};

const SEVERITY_TONE: Record<string, "rose" | "amber" | "neutral"> = { critical: "rose", warning: "amber", info: "neutral" };
const STATUS_TONE: Record<string, "rose" | "amber" | "indigo" | "green"> = { detected: "rose", acknowledged: "amber", investigating: "indigo", resolved: "green" };

function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).replace(/\bPct\b/i, "%").replace(/\bMs\b/i, "(ms)").trim();
}

function formatValue(key: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") return /pct$/i.test(key) ? `${value}%` : String(value);
  return String(value);
}

/** Generic evidence renderer — every incident's `detail` JSON is real,
 *  inspectable data (not just a title string), so any check that adds a new
 *  shape to `detail` gets a reasonable rendering here for free. Two field
 *  shapes get special treatment because they're the ones worth reading at a
 *  glance: an object of counts (e.g. failure-category breakdown) and an array
 *  of affected references (e.g. the specific transactions behind a spike). */
function EvidencePanel({ detail }: { detail: unknown }) {
  if (!detail || typeof detail !== "object") return null;
  const entries = Object.entries(detail as Record<string, unknown>);
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-line-soft bg-surface-2/60 px-3 py-2 text-xs">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {entries.map(([key, value]) => {
          if (Array.isArray(value)) return null; // rendered separately below
          if (value && typeof value === "object") return null; // rendered separately below
          return (
            <div key={key}>
              <span className="text-faint">{humanizeKey(key)}:</span> <span className="font-medium tabular-nums">{formatValue(key, value)}</span>
            </div>
          );
        })}
      </div>
      {entries.map(([key, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const counts = Object.entries(value as Record<string, number>).sort((a, b) => b[1] - a[1]);
        if (counts.length === 0) return null;
        return (
          <div key={key} className="mt-1.5">
            <span className="text-faint">{humanizeKey(key)}:</span>{" "}
            {counts.map(([cat, n], i) => (
              <span key={cat}>
                {i > 0 && ", "}
                {cat.replace(/_/g, " ")} ({n})
              </span>
            ))}
          </div>
        );
      })}
      {entries.map(([key, value]) => {
        if (!Array.isArray(value) || value.length === 0) return null;
        return (
          <div key={key} className="mt-1.5">
            <span className="text-faint">{humanizeKey(key)} ({value.length}):</span>{" "}
            <span className="font-mono">{value.slice(0, 10).join(", ")}{value.length > 10 ? `, +${value.length - 10} more` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

export function IncidentRow({ data }: { data: IncidentRowData }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-line-soft px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_TONE[data.severity] ?? "neutral"} dot>{data.severity}</Badge>
          <Badge tone={STATUS_TONE[data.status] ?? "neutral"}>{data.status}</Badge>
          <span className="font-medium">{data.title}</span>
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
        {data.source} · first detected {timeAgo(data.firstDetectedAt)} · last seen {timeAgo(data.lastDetectedAt)} · {data.occurrenceCount} occurrence{data.occurrenceCount === 1 ? "" : "s"}
      </div>
      <EvidencePanel detail={data.detail} />
      {data.status === "resolved" && (
        <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
          <div><b>Cause:</b> {data.cause}</div>
          <div><b>Resolution:</b> {data.resolutionNote}</div>
          {data.resolvedAt && <div className="mt-0.5 text-faint">Resolved {timeAgo(data.resolvedAt)}</div>}
        </div>
      )}
    </div>
  );
}
