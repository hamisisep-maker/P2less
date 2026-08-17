import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Logo } from "@/components/ui";
import { LoginForm } from "./login-form";

// Queries the DB, so it must render per-request, not be statically prerendered
// at build time (the DB isn't reachable during the build step, only at runtime).
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const current = await getCurrentUser();
  if (current) redirect(current.isSuperAdmin ? "/admin" : "/dashboard");

  const demo = await db.user.findMany({
    where: { isSuperAdmin: false },
    include: { userRoles: { include: { role: true } }, tenant: true },
    orderBy: { createdAt: "asc" },
    take: 8,
  });
  // One owner per tenant, for a compact multi-organization demo list.
  const seen = new Set<string>();
  const accounts = demo
    .filter((u) => u.tenantId && !seen.has(u.tenantId) && (seen.add(u.tenantId), true))
    .map((u) => ({ email: u.email, name: u.name, role: u.tenant?.name ?? "Organization" }));

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.5) 1px,transparent 1px)", backgroundSize: "36px 36px" }} />
        <Logo dark />
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight">Stop logging into systems. Start talking to them.</p>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            The organization dashboard: connect your systems, build conversational capabilities,
            watch conversations, and govern access — all in one place.
          </p>
        </div>
        <div className="relative text-xs text-white/40">P2Less Platform · MVP</div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Sign in to your organization.</p>
          <LoginForm accounts={accounts} />
        </div>
      </div>
    </div>
  );
}
