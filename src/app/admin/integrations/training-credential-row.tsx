"use client";

import { Power, PowerOff } from "lucide-react";
import { Badge, timeAgo } from "@/components/ui";
import { ReasonAction } from "@/components/admin/reason-action";
import { revokeTrainingCredentialAction, reactivateTrainingCredentialAction } from "@/lib/training-integration-actions";

export type TrainingCredentialRowData = {
  id: string;
  name: string;
  scopes: string[];
  revokedAt: string | null; // ISO — passed as a string across the server/client boundary
  lastUsedAt: string | null;
  createdAt: string;
};

export function TrainingCredentialRow({ data }: { data: TrainingCredentialRowData }) {
  const active = !data.revokedAt;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{data.name}</span>
          {active ? <Badge tone="green" dot>active</Badge> : <Badge tone="rose" dot>disabled</Badge>}
          {data.scopes.map((s) => (
            <Badge key={s} tone="neutral">{s}</Badge>
          ))}
        </div>
        <div className="mt-1 text-xs text-muted">
          {data.lastUsedAt ? <span suppressHydrationWarning>last used {timeAgo(new Date(data.lastUsedAt))}</span> : "never used"}
          <span className="text-faint" suppressHydrationWarning> · issued {timeAgo(new Date(data.createdAt))}</span>
        </div>
      </div>
      <ReasonAction
        label={
          <span className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${active ? "border-rose/30 text-rose hover:bg-rose-soft" : "border-green/30 text-green hover:bg-green-soft"}`}>
            {active ? <PowerOff size={12} /> : <Power size={12} />} {active ? "Disable" : "Re-enable"}
          </span>
        }
        confirmLabel={active ? "Disable" : "Re-enable"}
        placeholder="Reason (required)…"
        onConfirm={(reason) => (active ? revokeTrainingCredentialAction(data.id, reason) : reactivateTrainingCredentialAction(data.id, reason))}
        successMessage={active ? "Disabled — every training API request using this credential is now rejected immediately" : "Re-enabled"}
      />
    </div>
  );
}
