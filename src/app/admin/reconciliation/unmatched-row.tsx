"use client";

import { Badge, timeAgo } from "@/components/ui";
import { ReasonAction } from "@/components/admin/reason-action";
import { ignoreUnmatchedTransactionAction } from "@/lib/reconciliation-actions";
import { MatchModal } from "./match-modal";
import { InvoiceMatchModal } from "./invoice-match-modal";

export type UnmatchedRowData = {
  id: string; channelKey: string; providerRef: string; amount: number; currency: string;
  occurredAt: Date; senderName: string | null; senderMsisdn: string | null; reference: string | null;
};

const CHANNEL_LABELS: Record<string, string> = { mpesa_paybill: "PayBill", mpesa_till: "Till", bank_transfer: "Bank transfer" };

export function UnmatchedRow({ data, tenants }: { data: UnmatchedRowData; tenants: { id: string; name: string }[] }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/30 bg-amber-soft/30 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{data.providerRef}</span>
          <Badge tone="amber">{CHANNEL_LABELS[data.channelKey] ?? data.channelKey}</Badge>
          <span className="font-medium">{data.currency} {data.amount.toLocaleString("en-US")}</span>
        </div>
        <div className="mt-1 text-xs text-muted">
          {data.senderName ?? "Unknown sender"} {data.senderMsisdn && `· ${data.senderMsisdn}`} {data.reference && `· ref "${data.reference}"`} · <span suppressHydrationWarning>{timeAgo(data.occurredAt)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <InvoiceMatchModal txId={data.id} providerRef={data.providerRef} defaultQuery={data.reference ?? ""} amountKes={data.amount} />
        <MatchModal txId={data.id} providerRef={data.providerRef} tenants={tenants} />
        <ReasonAction
          label={<span className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2">Ignore</span>}
          confirmLabel="Ignore"
          placeholder="Reason (required)…"
          onConfirm={(reason) => ignoreUnmatchedTransactionAction(data.id, reason)}
          successMessage="Marked as ignored"
        />
      </div>
    </div>
  );
}
