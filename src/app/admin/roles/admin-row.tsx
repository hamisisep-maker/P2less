"use client";

import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui";
import { Avatar } from "@/components/dashboard-ui";
import { Modal } from "@/components/dashboard-ui";
import { AssignRoleForm } from "./assign-role-form";

export type AdminRowData = {
  id: string; name: string; email: string; roleName: string | null; roleKey: string | null;
  isSuperAdmin: boolean; adminScope: string[] | null; scopeNames: string[];
};

export function AdminRow({
  admin, isSelf, roles, tenants,
}: {
  admin: AdminRowData;
  isSelf: boolean;
  roles: { id: string; name: string; key: string }[];
  tenants: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <Avatar name={admin.name} size={32} />
        <div>
          <div className="text-sm font-medium">{admin.name} {isSelf && <span className="text-xs text-faint">(you)</span>}</div>
          <div className="text-xs text-muted">{admin.email}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={admin.roleKey === "super_admin" ? "accent" : "neutral"}>{admin.roleName ?? "No role"}</Badge>
        <Badge tone="neutral">{admin.scopeNames.length ? admin.scopeNames.join(", ") : "All tenants"}</Badge>
        {isSelf ? (
          <span className="text-[11px] text-faint">Ask another Super Admin to change your role</span>
        ) : (
          <ChangeRoleModal admin={admin} roles={roles} tenants={tenants} />
        )}
      </div>
    </div>
  );
}

function ChangeRoleModal({ admin, roles, tenants }: { admin: AdminRowData; roles: { id: string; name: string; key: string }[]; tenants: { id: string; name: string }[] }) {
  return (
    <Modal
      title={`Change role — ${admin.name}`}
      description="Every change here is written to the audit trail with your reason."
      trigger={
        <button className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2">
          <Pencil size={12} /> Change role
        </button>
      }
    >
      <AssignRoleForm
        user={{ id: admin.id, name: admin.name, adminScope: admin.adminScope }}
        roles={roles}
        tenants={tenants}
        onDone={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))}
      />
    </Modal>
  );
}
