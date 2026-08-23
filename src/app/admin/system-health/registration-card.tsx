"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Badge } from "@/components/ui";
import { setPublicRegistrationEnabledAction } from "@/lib/maintenance-actions";

export function RegistrationCard({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  return (
    <div className="rounded-2xl border border-line p-5">
      <div className="flex items-center gap-2">
        <UserPlus size={18} className={enabled ? "text-muted" : "text-rose"} />
        <h2 className="font-display font-semibold">Public tenant registration</h2>
        <Badge tone={enabled ? "green" : "rose"} dot>{enabled ? "open" : "paused"}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted">
        Controls /onboard, the public self-serve signup link — not existing tenants, not staff/admin login. Enforced server-side, not just hidden in the UI.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`Reason for ${enabled ? "pausing" : "reopening"} signups (required)`}
          className="min-w-[240px] flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          disabled={pending || !reason.trim()}
          onClick={() => startTransition(async () => {
            const res = await setPublicRegistrationEnabledAction(!enabled, reason);
            if (res.error) { toast.error(res.error); return; }
            toast.success(enabled ? "Public registration paused" : "Public registration reopened");
            setReason("");
          })}
          className={enabled
            ? "rounded-xl border border-rose/40 bg-rose-soft px-4 py-2 text-sm font-semibold text-rose disabled:opacity-60"
            : "rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"}
        >
          {pending ? "Saving…" : enabled ? "Pause signups" : "Reopen signups"}
        </button>
      </div>
    </div>
  );
}
