"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { changeAdminPasswordAction } from "@/lib/admin-actions";

type State = { error?: string; ok?: boolean; message?: string } | null;

export function PasswordForm() {
  const [state, action, pending] = useActionState<State, FormData>(changeAdminPasswordAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) { toast.success(state.message ?? "Updated"); formRef.current?.reset(); }
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form ref={formRef} action={action} className="max-w-sm space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-muted">Current password</span>
        <input name="currentPassword" type="password" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">New password</span>
        <input name="newPassword" type="password" required minLength={8} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        <span className="mt-0.5 block text-[11px] text-faint">At least 8 characters.</span>
      </label>
      <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
