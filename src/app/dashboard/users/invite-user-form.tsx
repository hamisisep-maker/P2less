"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui";
import { inviteUserAction, type InviteUserResult } from "@/lib/actions";

type RoleOption = { id: string; name: string };

/** Credentials are shown exactly once, same pattern as the owner's own
 *  /onboard signup (SuccessScreen) — copy them now, they're not retrievable
 *  again. Honest about whether an email actually went out (isEmailConfigured
 *  in the action) rather than implying one always does. */
function CredentialsReveal({ email, password, emailSent, onDone }: { email: string; password: string; emailSent: boolean; onDone: () => void }) {
  return (
    <Card className="mb-4 border-accent/30 bg-accent-soft p-5">
      <h3 className="font-display font-semibold">Teammate added</h3>
      <p className="mt-1 text-sm text-muted">
        {emailSent
          ? `An email with these sign-in details was sent to ${email}.`
          : `No email provider is configured yet — copy these details and share them with your teammate directly.`}
      </p>
      <div className="mt-3 space-y-1.5 rounded-xl bg-surface p-3 text-sm">
        <div className="flex justify-between"><span className="text-muted">Email</span><span className="font-mono">{email}</span></div>
        <div className="flex justify-between"><span className="text-muted">Password</span><span className="font-mono">{password}</span></div>
      </div>
      <p className="mt-2 text-xs text-faint">This password is shown once and can&apos;t be retrieved again — they can change it after signing in.</p>
      <button onClick={onDone} className="mt-3 rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-surface-2">Done</button>
    </Card>
  );
}

export function InviteUserForm({ roles }: { roles: RoleOption[] }) {
  const [state, action, pending] = useActionState<InviteUserResult | null, FormData>(inviteUserAction, null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (state && "error" in state) toast.error(state.error);
    if (state && "ok" in state) setDismissed(false);
  }, [state]);

  const success = state && "ok" in state && !dismissed ? state : null;

  if (success) {
    return <CredentialsReveal email={success.email} password={success.password} emailSent={success.emailSent} onDone={() => setDismissed(true)} />;
  }

  return (
    <Card className="mb-4 p-5">
      <h3 className="mb-1 font-display font-semibold">Invite a teammate</h3>
      <p className="mb-3 text-xs text-muted">They&apos;ll get their own login and only the access their role grants.</p>
      <form action={action} className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-muted">Name</span>
          <input name="name" required placeholder="Jane Doe" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Email</span>
          <input name="email" type="email" required placeholder="jane@example.com" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">Role</span>
          <select name="roleId" required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
            <option value="">Pick a role…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-3 sm:w-fit">
          {pending ? "Adding…" : "Add teammate"}
        </button>
      </form>
    </Card>
  );
}
