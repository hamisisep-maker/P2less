"use client";

import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { AlertOctagon } from "lucide-react";
import { Badge } from "@/components/ui";
import { enableMaintenanceModeAction, disableMaintenanceModeAction } from "@/lib/maintenance-actions";

type State = { error?: string; ok?: boolean } | null;

export function MaintenanceCard({ enabled, reason, startedAt }: { enabled: boolean; reason: string; startedAt: string }) {
  const [state, action, pending] = useActionState<State, FormData>(enableMaintenanceModeAction, null);
  const [disabling, startDisable] = useTransition();

  useEffect(() => {
    if (state?.ok) toast.success("Maintenance mode enabled");
    if (state?.error) toast.error(state.error);
  }, [state]);

  if (enabled) {
    return (
      <div className="rounded-2xl border border-rose/30 bg-rose-soft/30 p-5">
        <div className="flex items-center gap-2">
          <AlertOctagon size={18} className="text-rose" />
          <h2 className="font-display font-semibold">Maintenance mode is ON</h2>
          <Badge tone="rose" dot>live</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">Started {startedAt || "recently"} · Reason: {reason || "(none recorded)"}</p>
        <p className="mt-1 text-xs text-faint">The tenant dashboard is showing a maintenance screen to all organization staff right now.</p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const reasonInput = (e.currentTarget.elements.namedItem("disableReason") as HTMLInputElement).value;
            startDisable(async () => {
              const res = await disableMaintenanceModeAction(reasonInput);
              if ("error" in res && res.error) { toast.error(res.error); return; }
              toast.success("Maintenance mode disabled");
            });
          }}
        >
          <input name="disableReason" required placeholder="Reason for ending maintenance (required)" className="min-w-[240px] flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
          <button type="submit" disabled={disabling} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {disabling ? "Ending…" : "End maintenance"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line p-5">
      <div className="flex items-center gap-2">
        <AlertOctagon size={18} className="text-muted" />
        <h2 className="font-display font-semibold">Platform maintenance mode</h2>
      </div>
      <p className="mt-1 text-xs text-muted">
        Whole-platform, not one integration. Deliberately hard to trigger — type <b>MAINTENANCE</b> exactly, plus a reason and a message tenants will see.
      </p>
      <form action={action} className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-muted">Reason (required, audit trail)</span>
          <input name="reason" required placeholder="e.g. Database migration" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-muted">Message shown to users (required)</span>
          <input name="message" required defaultValue="P2Less is undergoing scheduled maintenance. We'll be back shortly." className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Expected duration (minutes)</span>
          <input name="durationMinutes" type="number" min="1" defaultValue={30} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Type &quot;MAINTENANCE&quot; to confirm</span>
          <input name="typedConfirmation" required placeholder="MAINTENANCE" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        <button type="submit" disabled={pending} className="rounded-xl border border-rose/40 bg-rose-soft px-4 py-2.5 text-sm font-semibold text-rose disabled:opacity-60 sm:col-span-2">
          {pending ? "Enabling…" : "Enable maintenance mode"}
        </button>
      </form>
    </div>
  );
}
