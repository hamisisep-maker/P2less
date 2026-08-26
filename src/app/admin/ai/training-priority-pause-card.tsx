"use client";

import { useState } from "react";
import { Pause, PlayCircle } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { setAiPauseExceptTenantAction } from "@/lib/admin-actions";
import { ReasonAction } from "@/components/admin/reason-action";

type TenantOption = { id: string; name: string };

/** Training-priority AI pause, 2026-08-26 — direct request while running
 *  P2Less's own internal AI-quality training: every other tenant's real
 *  traffic competes for the same shared provider quota, the exact
 *  Groq-exhaustion incident that triggered admin-editable keys. This is the
 *  one-click "block everyone else's AI, one-click restore" control, not a
 *  per-tenant setting — enforced platform-wide in ai.ts's callLLM(). */
export function TrainingPriorityPauseCard({ tenants, pausedTenant }: { tenants: TenantOption[]; pausedTenant: TenantOption | null }) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");

  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display font-semibold">Training-priority mode</h2>
        {pausedTenant ? (
          <Badge tone="amber" dot>paused for everyone except {pausedTenant.name}</Badge>
        ) : (
          <Badge tone="green" dot>normal — every tenant's AI is active</Badge>
        )}
      </div>
      <p className="mb-3 mt-1 text-xs text-muted">
        Pausing blocks AI replies for every tenant except the one you pick — their messages still arrive and get logged, they just don't get an AI-generated reply until you restore. Use this when one tenant's training or testing shouldn't have to compete for shared provider quota.
      </p>

      {pausedTenant ? (
        <ReasonAction
          label={<span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted hover:bg-surface-2"><PlayCircle size={13} /> Restore normal AI for all tenants</span>}
          confirmLabel="Restore"
          onConfirm={(reason) => setAiPauseExceptTenantAction("", reason)}
          successMessage="AI restored for every tenant"
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
          >
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <ReasonAction
            label={<span className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted hover:bg-surface-2"><Pause size={13} /> Pause AI for every other tenant</span>}
            confirmLabel="Pause"
            onConfirm={(reason) => setAiPauseExceptTenantAction(tenantId, reason)}
            successMessage={() => `AI paused for every tenant except ${tenants.find((t) => t.id === tenantId)?.name ?? "the selected tenant"}`}
          />
        </div>
      )}
    </Card>
  );
}
