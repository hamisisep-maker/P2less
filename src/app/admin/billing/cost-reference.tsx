import { ExternalLink } from "lucide-react";
import { Badge, timeAgo } from "@/components/ui";

export type CostReferenceRow = {
  label: string;
  value: string; // pre-formatted, e.g. "KES 1.00" or "$0.010"
  source: string;
  url?: string;
  updatedAt: Date | null; // null = still on the built-in default, never explicitly verified
  status: "configured" | "reference-only"; // reference-only = a real cost, but the channel isn't built yet
};

function Row({ row }: { row: CostReferenceRow }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2.5 pr-3 align-top">
        <div className="font-medium">{row.label}</div>
        {row.status === "reference-only" && <Badge tone="neutral">not yet a channel</Badge>}
      </td>
      <td className="py-2.5 pr-3 align-top font-mono text-sm font-medium">{row.value}</td>
      <td className="py-2.5 pr-3 align-top text-xs text-muted">
        {row.source}
        {row.url && (
          <a href={row.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-accent hover:underline">
            source <ExternalLink size={11} />
          </a>
        )}
      </td>
      <td className="py-2.5 align-top text-xs text-muted">
        {row.updatedAt
          ? timeAgo(row.updatedAt)
          : row.status === "configured"
            ? <span className="text-amber">still on default — never verified</span>
            : <span className="text-faint">see source</span>}
      </td>
    </tr>
  );
}

export function CostReferenceTable({ rows }: { rows: CostReferenceRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-faint">
            <th className="pb-2 pr-3">What</th>
            <th className="pb-2 pr-3">Current value</th>
            <th className="pb-2 pr-3">Where it comes from</th>
            <th className="pb-2">Last verified</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <Row key={r.label} row={r} />)}
        </tbody>
      </table>
    </div>
  );
}
