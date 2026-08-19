"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import { Badge, timeAgo } from "@/components/ui";
import { linkIncidentAction } from "@/lib/ticket-actions";

type SuggestedTicket = { id: string; number: string | null; tenantName: string; subject: string; category: string; createdAt: Date };

export function SuggestedTicketsPanel({ incidentIdentifier, tickets, canLink }: { incidentIdentifier: string; tickets: SuggestedTicket[]; canLink: boolean }) {
  const [pending, startTransition] = useTransition();
  const [linked, setLinked] = useState<Set<string>>(new Set());

  return (
    <div className="space-y-1.5">
      {tickets.filter((t) => !linked.has(t.id)).map((t) => (
        <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft px-3 py-2 text-sm">
          <div>
            <span className="font-mono text-xs">{t.number ?? t.id.slice(0, 8)}</span> · <Badge tone="neutral">{t.category}</Badge> {t.tenantName} — {t.subject}
            <span className="ml-2 text-xs text-faint">{timeAgo(t.createdAt)}</span>
          </div>
          {canLink && (
            <button
              disabled={pending}
              onClick={() => startTransition(async () => {
                const res = await linkIncidentAction(t.id, incidentIdentifier);
                if (res.error) { toast.error(res.error); return; }
                toast.success("Linked to incident");
                setLinked((s) => new Set(s).add(t.id));
              })}
              className="rounded-lg border border-accent/40 px-2.5 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-soft"
            >
              Confirm link
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
