"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/actions";
import { PasswordInput } from "@/components/password-input";

type Account = { email: string; name: string; role: string };

export function LoginForm({ accounts }: { accounts: Account[] }) {
  const [state, action, pending] = useActionState(loginAction, null as { error?: string } | null);
  const isDemo = accounts.length > 0;

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="text-sm font-medium">Email</label>
        <input name="email" type="email" required defaultValue={isDemo ? accounts[0]?.email : undefined} className="mt-1 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent" />
      </div>
      <div>
        <label className="text-sm font-medium">Password</label>
        <PasswordInput name="password" required defaultValue={isDemo ? "password" : undefined} className="mt-1 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent" />
      </div>
      {state?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{state.error}</div>}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>

      {accounts.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs">
          <div className="mb-1.5 font-medium text-muted">Demo accounts — password: <code>password</code></div>
          <div className="space-y-1">
            {accounts.map((a) => (
              <div key={a.email} className="flex justify-between">
                <span className="text-ink">{a.email}</span>
                <span className="text-faint">{a.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
