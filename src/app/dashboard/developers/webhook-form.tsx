"use client";

import { useActionState } from "react";
import { addWebhookAction } from "@/lib/actions";

const EVENTS = ["message.received", "message.sent", "conversation.escalated", "payment.paid", "document.generated"];
type State = { ok?: boolean; secret?: string; error?: string } | null;

export function WebhookForm() {
  const [state, action, pending] = useActionState(addWebhookAction, null as State);
  return (
    <div>
      {state?.ok && state.secret && (
        <div className="mb-3 rounded-xl border border-green/30 bg-green-soft p-3">
          <div className="text-xs font-medium text-green">Endpoint added. Signing secret (verify the <code>X-P2Less-Signature</code> header):</div>
          <code className="mt-1 block break-all font-mono text-sm text-ink">{state.secret}</code>
        </div>
      )}
      <form action={action} className="space-y-3">
        <input name="url" placeholder="https://your-app.com/webhooks/p2less" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {EVENTS.map((e) => (
            <label key={e} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="events" value={e} defaultChecked={e === "message.received"} /> <span className="font-mono text-xs">{e}</span>
            </label>
          ))}
        </div>
        <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-60">
          {pending ? "Adding…" : "Add endpoint"}
        </button>
      </form>
      {state?.error && <p className="mt-2 text-sm text-rose">{state.error}</p>}
    </div>
  );
}
