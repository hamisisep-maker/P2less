import Link from "next/link";
import { Logo, Card } from "@/components/ui";
import { getSetting } from "@/lib/platform-settings";
import { OnboardForm } from "./onboard-form";

// Was static (○) — now reads a live setting per request, so it must be
// forced dynamic. Without this, Next tries to prerender it AT BUILD TIME,
// when there's no database file yet (it's only mounted at runtime), and the
// build fails outright. Real failure, not a hypothetical: this broke the
// 2026-08-23 production deploy the first time this page went from static
// markup to a getSetting() call.
export const dynamic = "force-dynamic";

export default async function OnboardPage() {
  const registrationEnabled = (await getSetting("public_registration_enabled")) === "1";
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <Link href="/login" className="text-sm text-muted hover:text-ink">Sign in</Link>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-8 lg:grid-cols-2">
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Connect your WhatsApp number in minutes</h1>
          <p className="mt-3 text-muted">
            No Meta developer account, no dashboard wrangling, no manual API setup.
            You tell P2Less the number you want to power; P2Less handles the WhatsApp
            Business registration with Meta for you.
          </p>
          <ol className="mt-6 space-y-3 text-sm">
            {[
              ["Enter your organization + the number", "The number you want customers to message."],
              ["Confirm with Meta (Embedded Signup)", "A single Meta popup verifies you own the number and creates the WhatsApp Business account — P2Less receives it automatically. No dashboard steps."],
              ["Start talking", "Your dashboard is ready. Connect your systems and go live."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white">{i + 1}</span>
                <span><b>{t}</b><span className="mt-0.5 block text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-xl border border-line bg-surface-2 p-4 text-xs text-muted">
            The expensive, manual Meta onboarding is replaced by <b>Embedded Signup</b>, where
            P2Less is the registered Tech Provider. The org authorizes once; the number is
            provisioned to P2Less programmatically. (This demo provisions your workspace and
            marks the number <b>pending</b> — the live Meta Embedded Signup call is the one hook
            that plugs in here.)
          </div>
        </div>
        {registrationEnabled ? (
          <OnboardForm />
        ) : (
          <Card className="p-6">
            <h2 className="text-lg font-semibold">New signups are currently paused</h2>
            <p className="mt-2 text-sm text-muted">P2Less isn&apos;t accepting new self-serve signups right now. If you were invited, contact whoever sent you the link. Otherwise, check back soon.</p>
            <Link href="/login" className="mt-4 inline-block text-sm text-accent hover:underline">Already have an account? Sign in →</Link>
          </Card>
        )}
      </main>
    </div>
  );
}
