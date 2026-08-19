"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { runIncidentSweepNowAction } from "@/lib/incident-actions";

export function RunSweepButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => {
        const res = await runIncidentSweepNowAction();
        if ("error" in res && res.error) { toast.error(res.error); return; }
        toast.success("Sweep complete");
      })}
      className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 disabled:opacity-50"
    >
      <RefreshCw size={15} className={pending ? "animate-spin" : ""} /> {pending ? "Running…" : "Run sweep now"}
    </button>
  );
}
