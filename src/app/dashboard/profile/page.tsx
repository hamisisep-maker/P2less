import { requireTenantUser } from "@/lib/auth";
import { Card, PageHeader, Badge, timeAgo } from "@/components/ui";
import { Avatar } from "@/components/dashboard-ui";
import { PasswordForm } from "./password-form";

// Real gap found in the 2026-08-23 UX audit: the tenant dashboard had no
// profile page at all — UserMenu only offered sign-out. Fields shown here
// are exactly what's real on the User model (name/email/role/tenant/
// createdAt/passwordChangedAt) — no invented "last login", "2FA", or
// "session history" sections, since none of that is tracked today.
export default async function DashboardProfilePage() {
  const user = await requireTenantUser();
  const roleNames = user.userRoles.map((ur) => ur.role.name).join(", ") || "No role assigned";

  return (
    <div>
      <PageHeader title="My Profile" subtitle="Your account, role, and password for this workspace." />

      <Card className="p-5">
        <h2 className="mb-3 font-display font-semibold">Your profile</h2>
        <div className="flex items-center gap-3">
          <Avatar name={user.name} size={44} />
          <div>
            <div className="font-medium">{user.name}</div>
            <div className="text-sm text-muted">{user.email}</div>
          </div>
          <Badge tone="accent">{roleNames}</Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-faint">Organization</div>
            <div className="mt-1">{user.tenant?.name ?? "—"}</div>
          </div>
          <div className="rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-faint">Account created</div>
            <div className="mt-1" suppressHydrationWarning>{timeAgo(user.createdAt)}</div>
          </div>
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Change password</h2>
        <p className="mb-3 text-xs text-muted">
          {user.passwordChangedAt ? <>Last changed <span suppressHydrationWarning>{timeAgo(user.passwordChangedAt)}</span>.</> : "Never changed since account creation."}
        </p>
        <PasswordForm />
      </Card>
    </div>
  );
}
