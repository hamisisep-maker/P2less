"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { clearReconciliationAction } from "@/lib/admin-actions";

export function ReconciliationRow({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber/30 bg-amber-soft/40 px-3.5 py-2.5 text-sm">
      <div>
        <span className="font-medium">{tenantName}</span>
        <span className="ml-2 text-xs text-muted">Sent a renewal charge, no payment confirmation received yet — verify manually before this proceeds.</span>
      </div>
      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={() => startTransition(async () => { await clearReconciliationAction(tenantId, "paid"); toast.success(`${tenantName} marked as paid — reactivated`); })}
          className="flex items-center gap-1 rounded-lg border border-green/30 px-2.5 py-1.5 text-xs font-medium text-green hover:bg-green-soft"
        >
          <CheckCircle2 size={13} /> Confirm paid
        </button>
        <button
          disabled={pending}
          onClick={() => startTransition(async () => { await clearReconciliationAction(tenantId, "failed"); toast.success(`${tenantName} marked as failed — retry/grace resumes`); })}
          className="flex items-center gap-1 rounded-lg border border-rose/30 px-2.5 py-1.5 text-xs font-medium text-rose hover:bg-rose-soft"
        >
          <XCircle size={13} /> Confirm failed
        </button>
      </div>
    </div>
  );
}
