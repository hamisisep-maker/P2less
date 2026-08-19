"use client";

import { ExternalLink, BookOpen, CreditCard, Power, PowerOff } from "lucide-react";
import { Badge, timeAgo } from "@/components/ui";
import { CheckNowButton } from "./check-now-button";
import { ReasonAction } from "@/components/admin/reason-action";
import { toggleIntegrationEnabledAction } from "@/lib/integrations-actions";

export type IntegrationRowData = {
  key: string;
  name: string;
  provider: string;
  environment: string;
  enabled: boolean;
  lastCheckedAt: Date | null;
  lastCheckOk: boolean | null;
  lastCheckDetail: string | null;
  docsUrl: string | null;
  providerDashboardUrl: string | null;
  billingUrl: string | null;
  credentialStatus: "configured" | "not_configured" | "n/a";
};

function statusBadge(enabled: boolean, ok: boolean | null) {
  if (!enabled) return <Badge tone="neutral" dot>disabled</Badge>;
  if (ok === true) return <Badge tone="green" dot>healthy</Badge>;
  if (ok === false) return <Badge tone="rose" dot>unhealthy</Badge>;
  return <Badge tone="amber" dot>not configured</Badge>;
}

export function IntegrationRow({ data }: { data: IntegrationRowData }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{data.name}</span>
          <span className="text-xs text-faint">{data.provider}</span>
          <Badge tone="neutral">{data.environment}</Badge>
          {statusBadge(data.enabled, data.lastCheckOk)}
          {data.credentialStatus !== "n/a" && (
            <Badge tone={data.credentialStatus === "configured" ? "indigo" : "neutral"}>
              {data.credentialStatus === "configured" ? "credentials: ••••••••" : "credentials: not set"}
            </Badge>
          )}
        </div>
        <div className="mt-1 text-xs text-muted">
          {data.lastCheckDetail ?? "Not checked yet"}
          {data.lastCheckedAt && <span className="text-faint"> · checked {timeAgo(data.lastCheckedAt)}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {data.docsUrl && (
          <a href={data.docsUrl} target="_blank" rel="noopener noreferrer" title="Documentation" className="grid h-7 w-7 place-items-center rounded-lg border border-line text-faint hover:bg-surface-2 hover:text-ink">
            <BookOpen size={13} />
          </a>
        )}
        {data.providerDashboardUrl && (
          <a href={data.providerDashboardUrl} target="_blank" rel="noopener noreferrer" title="Provider dashboard" className="grid h-7 w-7 place-items-center rounded-lg border border-line text-faint hover:bg-surface-2 hover:text-ink">
            <ExternalLink size={13} />
          </a>
        )}
        {data.billingUrl && (
          <a href={data.billingUrl} target="_blank" rel="noopener noreferrer" title="Billing" className="grid h-7 w-7 place-items-center rounded-lg border border-line text-faint hover:bg-surface-2 hover:text-ink">
            <CreditCard size={13} />
          </a>
        )}
        <CheckNowButton integrationKey={data.key} />
        <ReasonAction
          label={
            <span className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${data.enabled ? "border-rose/30 text-rose hover:bg-rose-soft" : "border-green/30 text-green hover:bg-green-soft"}`}>
              {data.enabled ? <PowerOff size={12} /> : <Power size={12} />} {data.enabled ? "Disable" : "Enable"}
            </span>
          }
          confirmLabel={data.enabled ? "Disable" : "Enable"}
          placeholder="Reason (required)…"
          onConfirm={(reason) => toggleIntegrationEnabledAction(data.key, !data.enabled, reason)}
          successMessage={data.enabled ? "Disabled" : "Enabled"}
        />
      </div>
    </div>
  );
}
