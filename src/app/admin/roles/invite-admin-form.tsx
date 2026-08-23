"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { inviteAdminAction, type InviteAdminResult } from "@/lib/admin-roles-actions";

/** Credentials shown exactly once, same pattern as the tenant-side invite
 *  (inviteUserAction) and the owner's own /onboard signup — never
 *  retrievable again, honest about whether an email actually went out. */
function CredentialsReveal({ email, password, emailSent, onDone }: { email: string; password: string; emailSent: boolean; onDone: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {emailSent
          ? `An email with these sign-in details was sent to ${email}.`
          : `No email provider is configured yet — copy these details and share them with the new admin directly.`}
      </p>
      <div className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-sm">
        <div className="flex justify-between"><span className="text-muted">Email</span><span className="font-mono">{email}</span></div>
        <div className="flex justify-between"><span className="text-muted">Password</span><span className="font-mono">{password}</span></div>
      </div>
      <p className="text-xs text-faint">This password is shown once and can&apos;t be retrieved again — they can change it after signing in.</p>
      <button onClick={onDone} className="w-full rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-surface-2">Done</button>
    </div>
  );
}

export function InviteAdminForm({ roles, tenants, onDone }: { roles: { id: string; name: string; key: string }[]; tenants: { id: string; name: string }[]; onDone: () => void }) {
  const [state, action, pending] = useActionState<InviteAdminResult | null, FormData>(inviteAdminAction, null);

  useEffect(() => {
    if (state && "error" in state) toast.error(state.error);
  }, [state]);

  const success = state && "ok" in state ? state : null;
  if (success) return <CredentialsReveal email={success.email} password={success.password} emailSent={success.emailSent} onDone={onDone} />;

  return (
    <form action={action} className="space-y-3">
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
        <select name="roleId" required defaultValue="" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          <option value="" disabled>Choose a role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Tenant scope — hold Ctrl/Cmd to pick several, none selected = every tenant</span>
        <select name="scope" multiple className="mt-1 h-28 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Reason (required, audit trail)</span>
        <input name="reason" required placeholder="e.g. New Support Admin hire" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
        {pending ? "Adding…" : "Add admin"}
      </button>
    </form>
  );
}
