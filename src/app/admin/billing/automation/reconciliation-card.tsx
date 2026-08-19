"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { clearReconciliationAction } from "@/lib/admin-actions";
import { ReasonAction } from "@/components/admin/reason-action";

export function ReconciliationRow({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber/30 bg-amber-soft/40 px-3.5 py-2.5 text-sm">
      <div>
        <span className="font-medium">{tenantName}</span>
        <span className="ml-2 text-xs text-muted">Sent a renewal charge, no payment confirmation received yet — verify manually before this proceeds.</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <ReasonAction
          label={<span className="flex items-center gap-1 rounded-lg border border-green/30 px-2.5 py-1.5 text-xs font-medium text-green hover:bg-green-soft"><CheckCircle2 size={13} /> Confirm paid</span>}
          confirmLabel="Confirm paid"
          onConfirm={(reason) => clearReconciliationAction(tenantId, "paid", reason)}
          successMessage={`${tenantName} marked as paid — reactivated`}
        />
        <ReasonAction
          label={<span className="flex items-center gap-1 rounded-lg border border-rose/30 px-2.5 py-1.5 text-xs font-medium text-rose hover:bg-rose-soft"><XCircle size={13} /> Confirm failed</span>}
          confirmLabel="Confirm failed"
          onConfirm={(reason) => clearReconciliationAction(tenantId, "failed", reason)}
          successMessage={`${tenantName} marked as failed — retry/grace resumes`}
        />
      </div>
    </div>
  );
}
