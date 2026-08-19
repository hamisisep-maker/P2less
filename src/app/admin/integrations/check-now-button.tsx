"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { checkIntegrationNowAction } from "@/lib/integrations-actions";

export function CheckNowButton({ integrationKey }: { integrationKey: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await checkIntegrationNowAction(integrationKey);
          if ("error" in res) { toast.error(res.error); return; }
          const v = res.verdict;
          toast[v.ok === false ? "error" : "success"](v.detail);
        })
      }
      className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 disabled:opacity-50"
    >
      <RefreshCw size={12} className={pending ? "animate-spin" : ""} /> {pending ? "Checking…" : "Check now"}
    </button>
  );
}
