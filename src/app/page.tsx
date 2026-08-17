import Link from "next/link";
import { db } from "@/lib/db";
import { Logo } from "@/components/ui";

const ICON: Record<string, string> = { school: "🎓", hospital: "🏥", business: "🏢", government: "🏛️" };

export default async function Landing() {
  const numbers = await db.whatsAppNumber.findMany({
    where: { status: "active" },
    include: { tenant: true, _count: { select: { conversations: true } } },
    orderBy: { createdAt: "asc" },
  });

  const examples = [
    { n: "+254711562526", who: "Employee", q: "Send me my payslip.", a: "→ Hamzone Payroll API → payslip (after OTP)" },
    { n: "+254711000001", who: "Parent", q: "Show me John's results.", a: "→ Riverside School API → results" },
    { n: "+254711000002", who: "Patient", q: "When is my next appointment?", a: "→ Hospital PMS → appointment" },
    { n: "+254711000003", who: "Customer", q: "Where is my order?", a: "→ Retail Orders API → status" },
  ];

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-1.5 text-muted hover:text-ink">Dashboard</Link>
          <Link href="/onboard" className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-surface-2">Connect a number</Link>
          <Link href="/demo" className="rounded-lg bg-accent px-3.5 py-1.5 font-medium text-white hover:bg-accent-ink">Open the demo</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="grid items-center gap-10 py-12 lg:grid-cols-2 lg:py-16">
          <div className="animate-in">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
              The infrastructure behind your organization&apos;s WhatsApp number
            </div>
            <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">
              Stop logging into systems.<br /><span className="text-accent">Start talking to them.</span>
            </h1>
            <p className="mt-4 max-w-md text-muted">
              A user messages the organization&apos;s <b>own</b> WhatsApp number — nothing new to install.
              P2Less sits behind that number: it identifies who&apos;s asking, authenticates them, checks
              permissions, calls the organization&apos;s systems, and replies as the organization. The user
              never sees P2Less.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/demo" className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white hover:bg-accent-ink">Message an organization →</Link>
              <Link href="/login" className="rounded-xl border border-line bg-surface px-5 py-2.5 font-medium hover:bg-surface-2">Organization dashboard</Link>
            </div>
            <p className="mt-3 font-mono text-xs text-faint">
              User → Organization&apos;s WhatsApp number → P2Less → Organization&apos;s systems → back to the user
            </p>
          </div>

          <div className="animate-in rounded-3xl border border-line bg-surface p-6 shadow-sm">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">Same platform · one number each · isolated systems</div>
            <div className="space-y-2.5">
              {examples.map((f) => (
                <div key={f.n} className="rounded-2xl bg-surface-2 p-3">
                  <div className="flex items-center justify-between text-xs text-faint"><span className="font-mono">{f.n}</span><span>{f.who}</span></div>
                  <div className="mt-1 font-medium">“{f.q}”</div>
                  <div className="mt-0.5 text-xs text-muted">{f.a}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-faint">Registered organization numbers</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {numbers.map((n) => (
              <div key={n.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft">{ICON[n.tenant.industry] ?? "🏢"}</span>
                  <div className="min-w-0"><div className="truncate font-medium">{n.displayName}</div><div className="font-mono text-[11px] text-faint">{n.phoneNumber}</div></div>
                </div>
                <div className="mt-2 text-xs text-muted">{n.tenant.industry} · {n.department}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Number → tenant routing", "The destination number identifies the organization. One platform, thousands of numbers, isolated data."],
            ["Behind the org's identity", "Replies come from the organization, not a P2Less chatbot. The user never logs in."],
            ["Controlled connectors", "Each org exposes only the capabilities it configures. Permission-gated. Never free SQL."],
            ["Step-up auth", "OTP + verified sessions before any sensitive record leaves the system."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-line bg-surface p-5"><div className="font-semibold">{t}</div><div className="mt-1 text-sm text-muted">{d}</div></div>
          ))}
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-xs text-faint">
        P2Less — infrastructure behind the organization&apos;s WhatsApp number. One organization&apos;s number. One conversation. Many systems behind it.
      </footer>
    </div>
  );
}
