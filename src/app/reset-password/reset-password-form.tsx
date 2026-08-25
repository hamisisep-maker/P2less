"use client";

import { useActionState } from "react";
import Link from "next/link";
import { confirmPasswordResetAction } from "@/lib/actions";
import { PasswordInput } from "@/components/password-input";

type State = { error?: string } | null;

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<State, FormData>(confirmPasswordResetAction, null);
  const field = "mt-1 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent";
  const expired = state?.error?.toLowerCase().includes("expired") || state?.error?.toLowerCase().includes("already been used");

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="text-sm font-medium">New password</label>
        <PasswordInput name="newPassword" required minLength={8} className={field} />
      </div>
      {state?.error && (
        <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">
          {state.error}
          {expired && <> <Link href="/forgot-password" className="underline">Request a new link</Link>.</>}
        </div>
      )}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
