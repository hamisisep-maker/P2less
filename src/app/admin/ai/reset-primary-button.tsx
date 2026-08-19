"use client";

import { RotateCcw } from "lucide-react";
import { setPrimaryProviderAction } from "@/lib/admin-actions";
import { ReasonAction } from "@/components/admin/reason-action";

export function ResetPrimaryButton() {
  return (
    <ReasonAction
      label={<span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted hover:bg-surface-2"><RotateCcw size={13} /> Reset primary to auto</span>}
      confirmLabel="Reset"
      onConfirm={(reason) => setPrimaryProviderAction("", reason)}
      successMessage="Primary reset to automatic"
    />
  );
}
