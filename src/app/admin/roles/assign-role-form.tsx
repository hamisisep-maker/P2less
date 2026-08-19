"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { assignAdminRoleAction } from "@/lib/admin-roles-actions";

type State = { error?: string; ok?: boolean } | null;

export function AssignRoleForm({
  user, roles, tenants, onDone,
}: {
  user: { id: string; name: string; adminScope: string[] | null };
  roles: { id: string; name: string; key: string }[];
  tenants: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<State, FormData>(assignAdminRoleAction, null);

  useEffect(() => {
    if (state?.ok) { toast.success(`${user.name}'s role updated`); onDone(); }
    if (state?.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="userId" value={user.id} />
      <label className="block">
        <span className="text-xs font-medium text-muted">Role</span>
        <select name="roleId" required defaultValue="" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          <option value="" disabled>Choose a role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Tenant scope — hold Ctrl/Cmd to pick several, none selected = every tenant</span>
        <select name="scope" multiple defaultValue={user.adminScope ?? []} className="mt-1 h-28 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Reason (required, audit trail)</span>
        <input name="reason" required placeholder="e.g. Promoted to Finance Admin" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
