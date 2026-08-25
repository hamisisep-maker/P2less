import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runCrossTenant } from "@/lib/tenant-context";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

// Queries the DB, so it must render per-request, not be statically prerendered
// at build time (the DB isn't reachable during the build step, only at runtime).
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const current = await getCurrentUser();
  if (current) redirect(current.isSuperAdmin ? "/admin" : "/dashboard");

  // Demo-account listing is a real credential exposure (real seeded emails +
  // the literal shared password, pre-filled) — dev/staging convenience only,
  // never rendered against a production build (Gap-011, fixed 2026-08-23).
  const accounts = process.env.NODE_ENV === "production" ? [] : await runCrossTenant(async () => {
    const demo = await db.user.findMany({
      where: { isSuperAdmin: false },
      include: { userRoles: { include: { role: true } }, tenant: true },
      orderBy: { createdAt: "asc" },
      take: 8,
    });
    // One owner per tenant, for a compact multi-organization demo list.
    const seen = new Set<string>();
    return demo
      .filter((u) => u.tenantId && !seen.has(u.tenantId) && (seen.add(u.tenantId), true))
      .map((u) => ({ email: u.email, name: u.name, role: u.tenant?.name ?? "Organization" }));
  });

  return (
    <AuthShell>
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Sign in to your organization.</p>
      <LoginForm accounts={accounts} />
    </AuthShell>
  );
}
