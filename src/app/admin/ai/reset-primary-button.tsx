"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { setPrimaryProviderAction } from "@/lib/admin-actions";

export function ResetPrimaryButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => { await setPrimaryProviderAction(""); toast.success("Primary reset to automatic", { description: "Falls back to the AI_PROVIDER environment variable / auto-detect." }); })}
      className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted hover:bg-surface-2 disabled:opacity-50"
    >
      <RotateCcw size={13} /> {pending ? "…" : "Reset primary to auto"}
    </button>
  );
}
