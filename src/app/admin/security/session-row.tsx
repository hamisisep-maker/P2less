"use client";

import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui";
import { ReasonAction } from "@/components/admin/reason-action";
import { revokeSessionAction } from "@/lib/admin-security-actions";

export type SessionRowData = {
  id: string; userName: string; userEmail: string; ip: string | null; userAgent: string | null;
  createdAt: string; lastActiveAt: string; expiresAt: string; isCurrent: boolean;
};

export function SessionRow({ session }: { session: SessionRowData }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="font-medium">
          {session.userName} {session.isCurrent && <Badge tone="green" dot>this session</Badge>}
        </div>
        <div className="truncate text-xs text-muted">{session.userEmail} · {session.ip ?? "unknown IP"} · {session.userAgent ? session.userAgent.slice(0, 60) : "unknown device"}</div>
        <div className="text-[11px] text-faint">Signed in {session.createdAt} · last active {session.lastActiveAt} · expires {session.expiresAt}</div>
      </div>
      <ReasonAction
        label={<span className="flex items-center gap-1 rounded-lg border border-rose/30 px-2.5 py-1.5 text-xs font-medium text-rose hover:bg-rose-soft"><LogOut size={12} /> Revoke</span>}
        confirmLabel="Revoke"
        onConfirm={(reason) => revokeSessionAction(session.id, reason)}
        successMessage="Session revoked"
      />
    </div>
  );
}
