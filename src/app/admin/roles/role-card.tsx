"use client";

import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui";
import { Modal } from "@/components/dashboard-ui";
import { RoleForm } from "./role-form";
import { ReasonAction } from "@/components/admin/reason-action";
import { deleteAdminRoleAction } from "@/lib/admin-roles-actions";

export type RoleCardData = { id: string; key: string; name: string; permissions: string[]; isBuiltIn: boolean; assignedCount: number };

export function RoleCard({ role }: { role: RoleCardData }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-display font-semibold">{role.name}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {role.isBuiltIn && <Badge tone="indigo">built-in</Badge>}
          <Badge tone="neutral">{role.assignedCount} admin{role.assignedCount === 1 ? "" : "s"}</Badge>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted">{role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {role.permissions.slice(0, 6).map((p) => (
          <span key={p} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">{p}</span>
        ))}
        {role.permissions.length > 6 && <span className="text-[10px] text-faint">+{role.permissions.length - 6} more</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {role.key !== "super_admin" && <RoleEditModal role={role} />}
        {role.key === "super_admin" && <span className="text-[11px] text-faint">Fixed — full access, cannot be edited</span>}
        {!role.isBuiltIn && (
          <ReasonAction
            label={<span className="rounded-lg border border-rose/30 px-2.5 py-1.5 text-xs font-medium text-rose hover:bg-rose-soft">Delete</span>}
            confirmLabel="Delete"
            onConfirm={(reason) => deleteAdminRoleAction(role.id, reason)}
            successMessage={`${role.name} deleted`}
          />
        )}
      </div>
    </div>
  );
}

function RoleEditModal({ role }: { role: { id: string; name: string; permissions: string[] } }) {
  return (
    <Modal
      title={`Edit ${role.name}`}
      trigger={
        <button className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2">
          <Pencil size={12} /> Edit
        </button>
      }
    >
      <RoleForm mode="edit" role={role} onDone={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))} />
    </Modal>
  );
}
