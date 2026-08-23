"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setPaybillReferenceAction } from "@/lib/admin-actions";

/** The write side of a real gap found in a schema-drift audit, 2026-08-23:
 *  Subscription.paybillReference is read by the real C2B PayBill webhook to
 *  auto-match a direct deposit to this tenant, but nothing ever set it —
 *  every real PayBill payment was silently falling through to manual
 *  reconciliation instead. This is the admin-assigns-it-per-tenant flow the
 *  schema comment always described. */
export function PaybillReferenceField({ tenantId, initial, canManage }: { tenantId: string; initial: string | null; canManage: boolean }) {
  const [value, setValue] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();

  if (!canManage) {
    return <span>PayBill reference: {initial ?? "not set"}</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0">PayBill reference:</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="not set"
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
      />
      <button
        disabled={pending || value.trim() === (initial ?? "")}
        onClick={() =>
          startTransition(async () => {
            const res = await setPaybillReferenceAction(tenantId, value);
            if (res.error) { toast.error(res.error); return; }
            toast.success(value.trim() ? "PayBill reference set — direct deposits will now auto-match" : "PayBill reference cleared");
          })
        }
        className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-surface-2 disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
}
