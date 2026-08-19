"use client";

import { Plus } from "lucide-react";
import { Modal } from "@/components/dashboard-ui";
import { RoleForm } from "./role-form";

export function CreateRoleModal() {
  return (
    <Modal
      title="Create a custom role"
      description="Starts with zero permissions — check exactly what this role should be able to do."
      trigger={
        <button className="flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3.5 py-2 text-xs font-semibold text-white shadow-[var(--shadow-accent-glow)]">
          <Plus size={14} /> New role
        </button>
      }
    >
      <RoleForm mode="create" onDone={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))} />
    </Modal>
  );
}
