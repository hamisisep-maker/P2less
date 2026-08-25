import Link from "next/link";
import { withTenantUser } from "@/lib/auth";
import { Logo } from "@/components/ui";
import { ExploreWizard } from "./explore-wizard";

// Phase 2 "Explore" hub, 2026-08-25 — standalone full-screen shell outside
// the dashboard layout, matching /onboard's precedent. Deliberately not
// nested inside SidebarShell: on a first-ever visit (straight after login,
// before the tenant has picked anything) the sidebar would look sparse/half-
// loaded, and revisits via the "Explore P2Less" nav link should feel
// identical to the first pass, not different depending on entry point.
export default async function ExplorePage() {
  return withTenantUser(async (user) => {
    const initial = {
      useCases: (user.tenant?.useCases as string[] | null) ?? [],
      channelsNeeded: (user.tenant?.channelsNeeded as string[] | null) ?? [],
      signupGoal: user.tenant?.signupGoal ?? "",
    };
    return (
      <div className="min-h-screen">
        <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Logo />
          <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
            Skip to dashboard
          </Link>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8">
          <ExploreWizard initial={initial} />
        </main>
      </div>
    );
  });
}
