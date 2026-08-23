"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui";
import { toggleNotificationRuleAction } from "@/lib/admin-actions";

export type RuleRow = { id: string; event: string; channel: string; timingDays: number; enabled: boolean };

function ToggleCell({ rule }: { rule: RuleRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => {
        const res = await toggleNotificationRuleAction(rule.id, !rule.enabled);
        if (res && "error" in res) toast.error(res.error);
        else toast.success(`${rule.event.replace(/_/g, " ")} via ${rule.channel} ${!rule.enabled ? "enabled" : "disabled"}`);
      })}
      className="disabled:opacity-50"
    >
      <Badge tone={rule.enabled ? "green" : "neutral"} dot>{pending ? "…" : rule.enabled ? "Enabled" : "Disabled"}</Badge>
    </button>
  );
}

export function RulesTable({ rules }: { rules: RuleRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-faint">
            <th className="border-b border-line px-3 py-2">Event</th>
            <th className="border-b border-line px-3 py-2">Channel</th>
            <th className="border-b border-line px-3 py-2">Timing</th>
            <th className="border-b border-line px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-surface-2">
              <td className="px-3 py-2.5 font-medium capitalize">{r.event.replace(/_/g, " ")}</td>
              <td className="px-3 py-2.5 uppercase text-muted">{r.channel}</td>
              <td className="px-3 py-2.5 text-muted">{r.timingDays > 0 ? `${r.timingDays} day${r.timingDays === 1 ? "" : "s"} before` : "Immediately"}</td>
              <td className="px-3 py-2.5"><ToggleCell rule={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
