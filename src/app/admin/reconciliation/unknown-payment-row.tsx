"use client";

import { Badge, timeAgo } from "@/components/ui";
import { ReasonAction } from "@/components/admin/reason-action";
import { resolvePaymentUnknownAction } from "@/lib/reconciliation-actions";

export type UnknownPaymentRowData = {
  id: string; reference: string; tenantName: string; amount: number; currency: string;
  channelKey: string | null; purpose: string; createdAt: Date; invoiceNumber: string | null;
};

export function UnknownPaymentRow({ data }: { data: UnknownPaymentRowData }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose/30 bg-rose-soft/20 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{data.reference}</span>
          <Badge tone="rose">unknown</Badge>
          <span className="font-medium">{data.currency} {data.amount.toLocaleString("en-US")}</span>
        </div>
        <div className="mt-1 text-xs text-muted">
          {data.tenantName} · {data.purpose} · {data.channelKey ?? "mpesa_stk"} · sent <span suppressHydrationWarning>{timeAgo(data.createdAt)}</span> — no confirmation received, may still have succeeded
          {data.invoiceNumber && <> · <span className="font-medium text-accent-ink">→ "Resolve: paid" will settle invoice {data.invoiceNumber}</span></>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ReasonAction
          label={<span className="rounded-lg border border-green/30 px-2.5 py-1.5 text-xs font-medium text-green hover:bg-green-soft">Resolve: paid</span>}
          confirmLabel="Confirm paid"
          placeholder="Reason (required)…"
          onConfirm={(reason) => resolvePaymentUnknownAction(data.id, "paid", reason)}
          successMessage="Marked as paid"
        />
        <ReasonAction
          label={<span className="rounded-lg border border-rose/30 px-2.5 py-1.5 text-xs font-medium text-rose hover:bg-rose-soft">Resolve: failed</span>}
          confirmLabel="Confirm failed"
          placeholder="Reason (required)…"
          onConfirm={(reason) => resolvePaymentUnknownAction(data.id, "failed", reason)}
          successMessage="Marked as failed"
        />
      </div>
    </div>
  );
}
