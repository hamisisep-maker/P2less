"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { createAdminRoleAction, updateAdminRoleAction } from "@/lib/admin-roles-actions";
import { ADMIN_PERMISSIONS, PERMISSION_LABELS, type AdminPermission } from "@/lib/admin-permissions";

type State = { error?: string; ok?: boolean } | null;

function groupPermissions(): [string, AdminPermission[]][] {
  const groups = new Map<string, AdminPermission[]>();
  for (const p of ADMIN_PERMISSIONS) {
    const resource = p.split(".")[0]!;
    if (!groups.has(resource)) groups.set(resource, []);
    groups.get(resource)!.push(p);
  }
  return [...groups.entries()];
}
const GROUPS = groupPermissions();

export function RoleForm({
  mode, role, onDone,
}: {
  mode: "create" | "edit";
  role?: { id: string; name: string; permissions: string[] };
  onDone: () => void;
}) {
  const boundAction = mode === "create" ? createAdminRoleAction : updateAdminRoleAction;
  const [state, formAction, pending] = useActionState<State, FormData>(boundAction, null);

  useEffect(() => {
    if (state?.ok) { toast.success(mode === "create" ? "Role created" : "Role updated"); onDone(); }
    if (state?.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-3">
      {mode === "edit" && role && <input type="hidden" name="roleId" value={role.id} />}
      <label className="block">
        <span className="text-xs font-medium text-muted">Role name</span>
        <input name="name" required defaultValue={role?.name} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-line-soft p-3">
        {GROUPS.map(([resource, perms]) => (
          <div key={resource}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{resource}</div>
            <div className="space-y-1">
              {perms.map((p) => (
                <label key={p} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="permissions" value={p} defaultChecked={role?.permissions.includes(p) ?? false} className="rounded" />
                  {PERMISSION_LABELS[p]}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted">Reason for this change (required, audit trail)</span>
        <input name="reason" required placeholder="e.g. New finance hire needs billing access" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
        {pending ? "Saving…" : mode === "create" ? "Create role" : "Save role"}
      </button>
    </form>
  );
}
