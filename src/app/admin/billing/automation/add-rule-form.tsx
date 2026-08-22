"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { upsertNotificationRuleAction } from "@/lib/admin-actions";

type State = { error?: string; ok?: boolean } | null;

const EVENTS = [
  "renewal_reminder", "payment_received", "payment_failed", "subscription_expired", "account_suspended", "account_reactivated", "payment_reconciliation_needed",
  "incident_critical", "incident_opened", "ticket_created", "ticket_sla_breached", "whatsapp_connection_failed", "ai_provider_degraded", "usage_limit_exceeded",
  "onboard_signup_anomaly", "social_token_invalid",
];
const CHANNELS = ["email", "whatsapp", "sms"];

export function AddRuleForm() {
  const [state, action, pending] = useActionState<State, FormData>(upsertNotificationRuleAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) { toast.success("Notification rule saved"); formRef.current?.reset(); }
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-4">
      <label className="block">
        <span className="text-xs font-medium text-muted">Event</span>
        <select name="event" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          {EVENTS.map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Channel</span>
        <select name="channel" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Days before (0 = immediate)</span>
        <input name="timingDays" type="number" min="0" defaultValue={0} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <div className="flex items-end">
        <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
          {pending ? "Saving…" : "Add / update rule"}
        </button>
      </div>
    </form>
  );
}
