import { ShieldAlert, KeyRound } from "lucide-react";
import { db } from "@/lib/db";
import { withAdminPermission } from "@/lib/admin-authz";
import { getSession } from "@/lib/auth";
import { Card, PageHeader, Badge, timeAgo } from "@/components/ui";
import { SessionRow } from "./session-row";

export default async function AdminSecurityPage() {
  return withAdminPermission("security.manage", async () => {
    const session = await getSession();

    const admins = await db.user.findMany({
      where: { OR: [{ isSuperAdmin: true }, { adminRoleId: { not: null } }] },
      select: { id: true, name: true, email: true, passwordChangedAt: true, createdAt: true },
    });
    const adminEmails = admins.map((a) => a.email);
    const adminIds = admins.map((a) => a.id);

    const [sessions, recentAttempts, failedLast24h] = await Promise.all([
      db.userSession.findMany({
        where: { userId: { in: adminIds }, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { lastActiveAt: "desc" },
      }),
      db.loginAttempt.findMany({ where: { email: { in: adminEmails } }, orderBy: { createdAt: "desc" }, take: 15 }),
      db.loginAttempt.count({ where: { email: { in: adminEmails }, success: false, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    ]);

    return (
      <div>
        <PageHeader title="Security centre" subtitle="Active admin sessions, login activity, and account security — revoke access the moment something looks wrong." />

        {failedLast24h > 0 && (
          <Card className="mb-4 border-amber/30 bg-amber-soft/40 p-4">
            <div className="flex items-center gap-2 text-sm">
              <ShieldAlert size={16} className="text-amber" />
              <span className="font-medium">{failedLast24h} failed admin login attempt{failedLast24h === 1 ? "" : "s"} in the last 24 hours.</span>
            </div>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="mb-1 font-display font-semibold">Active sessions</h2>
          <p className="mb-3 text-xs text-muted">Every currently-valid admin session across every device. Revoking one signs that device out immediately — it doesn't wait for the JWT to expire.</p>
          {sessions.length === 0 && <p className="text-sm text-muted">No active sessions.</p>}
          <div className="space-y-2">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={{
                  id: s.id, userName: s.user.name, userEmail: s.user.email, ip: s.ip, userAgent: s.userAgent,
                  createdAt: timeAgo(s.createdAt), lastActiveAt: timeAgo(s.lastActiveAt),
                  expiresAt: s.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
                  isCurrent: session?.sid === s.id,
                }}
              />
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <h2 className="mb-3 font-display font-semibold">Recent login activity</h2>
          {recentAttempts.length === 0 && <p className="text-sm text-muted">No login attempts recorded yet.</p>}
          <div className="space-y-1.5">
            {recentAttempts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft px-3 py-2 text-xs">
                <span>{a.email} · {a.ip ?? "unknown IP"}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={a.success ? "green" : "rose"} dot>{a.success ? "success" : "failed"}</Badge>
                  <span className="text-faint">{timeAgo(a.createdAt)}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center gap-1.5">
            <KeyRound size={16} className="text-muted" />
            <h2 className="font-display font-semibold">Account security</h2>
          </div>
          <div className="space-y-2">
            {admins.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft px-3 py-2 text-xs">
                <span className="font-medium text-ink">{a.name} <span className="font-normal text-muted">({a.email})</span></span>
                <span className="text-faint">Password last changed: {a.passwordChangedAt ? timeAgo(a.passwordChangedAt) : "never (still the initial password)"}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-faint">
            Multi-factor authentication: <b>not available yet</b> — no MFA mechanism is wired into P2Less today. This is stated plainly rather than shown as configured.
          </p>
        </Card>
      </div>
    );
  });
}
