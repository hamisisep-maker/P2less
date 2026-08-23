"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui";
import { Avatar } from "@/components/dashboard-ui";
import { deactivateUserAction, reactivateUserAction } from "@/lib/actions";

type Props = {
  id: string;
  name: string;
  email: string;
  roleNames: string[];
  active: boolean;
  deactivated: boolean;
  canManage: boolean;
  isSelf: boolean;
};

export function StaffRow({ id, name, email, roleNames, active, deactivated, canManage, isSelf }: Props) {
  const [pending, startTransition] = useTransition();

  const onDeactivate = () => {
    if (!window.confirm(`Deactivate ${name}? They'll be signed out immediately and won't be able to log in until reactivated.`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("userId", id);
      const res = await deactivateUserAction(null, fd);
      if (res && "error" in res && res.error) toast.error(res.error);
      else toast.success(`${name} deactivated`);
    });
  };

  const onReactivate = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("userId", id);
      const res = await reactivateUserAction(null, fd);
      if (res && "error" in res && res.error) toast.error(res.error);
      else toast.success(`${name} reactivated`);
    });
  };

  return (
    <div className={`flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5 transition-colors hover:bg-surface-2 ${deactivated ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2.5">
        <Avatar name={name} size={30} />
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {name}
            {deactivated ? (
              <Badge tone="rose" dot>deactivated</Badge>
            ) : (
              <Badge tone={active ? "green" : "neutral"} dot>{active ? "active now" : "offline"}</Badge>
            )}
          </div>
          <div className="text-xs text-muted">{email}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">{roleNames.map((r) => <Badge key={r} tone="accent">{r}</Badge>)}</div>
        {canManage && !isSelf && (
          deactivated ? (
            <button type="button" onClick={onReactivate} disabled={pending} className="text-xs font-medium text-accent hover:underline disabled:opacity-60">
              {pending ? "…" : "Reactivate"}
            </button>
          ) : (
            <button type="button" onClick={onDeactivate} disabled={pending} className="text-xs font-medium text-rose hover:underline disabled:opacity-60">
              {pending ? "…" : "Deactivate"}
            </button>
          )
        )}
      </div>
    </div>
  );
}
