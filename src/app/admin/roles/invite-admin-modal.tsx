"use client";

import { UserPlus } from "lucide-react";
import { Modal } from "@/components/dashboard-ui";
import { InviteAdminForm } from "./invite-admin-form";

export function InviteAdminModal({ roles, tenants }: { roles: { id: string; name: string; key: string }[]; tenants: { id: string; name: string }[] }) {
  return (
    <Modal
      title="Add a platform admin"
      description="They'll get their own login and only the access their role and scope grant."
      trigger={
        <button className="flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-xs font-semibold hover:bg-surface-2">
          <UserPlus size={14} /> Add admin
        </button>
      }
    >
      <InviteAdminForm roles={roles} tenants={tenants} onDone={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))} />
    </Modal>
  );
}
