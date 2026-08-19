"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { PlayCircle } from "lucide-react";
import { runBillingCycleNowAction } from "@/lib/admin-actions";

export function RunNowButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => {
        const r = await runBillingCycleNowAction();
        toast.success("Billing cycle ran", { description: `${r.reminders} reminder(s) queued · ${r.renewalsAttempted} charge attempt(s) · ${r.suspended} suspension(s)` });
      })}
      className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 disabled:opacity-50"
    >
      <PlayCircle size={15} /> {pending ? "Running…" : "Run billing cycle now"}
    </button>
  );
}
