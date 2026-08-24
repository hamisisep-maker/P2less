"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Bug } from "lucide-react";
import { Badge } from "@/components/ui";
import { setQualityFeedbackInvitationEnabledAction } from "@/lib/maintenance-actions";

export function QualityFeedbackCard({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  return (
    <div className="rounded-2xl border border-line p-5">
      <div className="flex items-center gap-2">
        <Bug size={18} className={enabled ? "text-accent" : "text-muted"} />
        <h2 className="font-display font-semibold">Public feedback invitation</h2>
        <Badge tone={enabled ? "green" : "neutral"} dot>{enabled ? "public" : "invite-only"}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted">
        Controls whether the landing page shows a &quot;found a bug? tell us&quot; invitation to visitors. The widget itself already accepts reports from anyone, invite-only or not — this only controls whether it&apos;s publicly advertised. See docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`Reason for going ${enabled ? "invite-only" : "public"} (required)`}
          className="min-w-[240px] flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          disabled={pending || !reason.trim()}
          onClick={() => startTransition(async () => {
            const res = await setQualityFeedbackInvitationEnabledAction(!enabled, reason);
            if (res.error) { toast.error(res.error); return; }
            toast.success(enabled ? "Public invitation hidden — invite-only now" : "Public invitation is now live on the landing page");
            setReason("");
          })}
          className={enabled
            ? "rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            : "rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"}
        >
          {pending ? "Saving…" : enabled ? "Go invite-only" : "Go public"}
        </button>
      </div>
    </div>
  );
}
