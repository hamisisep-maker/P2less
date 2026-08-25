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
      <header className="mx-auto flex max-w-5xl items-center px-6 py-5">
        <Logo />
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-8 lg:grid-cols-2">
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Your conversational platform, ready in minutes</h1>
          <p className="mt-3 text-muted">
            Create your workspace and verify it&apos;s really you.
          </p>
          <ol className="mt-6 space-y-3 text-sm">
            {[
              ["Tell us about your organization", "How to reach you and your team."],
              ["Verify your phone", "A quick text confirms it's really you."],
              ["Start exploring", "Your dashboard is ready to use."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white">{i + 1}</span>
                <span><b>{t}</b><span className="mt-0.5 block text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-xl border border-line bg-surface-2 p-4 text-xs text-muted">
            P2Less connects your organization to customers on WhatsApp, Messenger, Telegram,
            and your website chat, and to the systems you already run. Connect any channel
            from your dashboard, whenever you&apos;re ready.
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
