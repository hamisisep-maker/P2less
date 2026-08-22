"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { setAutoPublishEnabledAction } from "@/lib/actions";

type State = { error?: string; ok?: true; warning?: string } | null;

export function AutoPublishToggle({ enabled, hasInstagram }: { enabled: boolean; hasInstagram: boolean }) {
  const [state, action, pending] = useActionState<State, FormData>(setAutoPublishEnabledAction, null);

  useEffect(() => {
    if (state?.ok && state.warning) toast.warning(state.warning);
    else if (state?.ok) toast.success("Saved");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="mt-3 flex items-start gap-3 rounded-xl border border-line-soft px-3.5 py-3">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        role="switch"
        aria-checked={enabled}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-accent" : "bg-line"} disabled:opacity-60`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
      <div>
        <div className="text-sm font-medium">Auto-publish new products to Facebook{hasInstagram ? " + Instagram" : ""}</div>
        <div className="mt-0.5 text-xs text-muted">
          {enabled
            ? "On — every new product you add gets posted automatically, no login needed after this."
            : "Off — your connected Page/Instagram never gets posted to unless you turn this on."}
          {!hasInstagram && " No Instagram Business account is linked to this Page yet, so only Facebook posts would go out."}
        </div>
      </div>
    </form>
  );
}
