import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Logo } from "@/components/ui";
import { AudienceOrbit } from "./audience-orbit";
import { AudienceTabs } from "./audience-tabs";
import { ChannelBadges } from "./channel-badges";
import { FaqAccordion } from "./faq-accordion";
import { LANDING_FAQS, AUDIENCES, CHANNELS, AUTOMATION_EXAMPLES } from "@/lib/landing-content";

// Queries the DB for real (aggregate-only) stats, so it must render
// per-request, not be statically prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "P2Less — WhatsApp Chatbot & Automation for Schools, Hospitals, SACCOs, Government & Business",
  description:
    "Turn the WhatsApp number, Facebook Page, Telegram bot, or website you already have into a real assistant — it verifies who's asking, calls your actual systems, and replies as you. Built for schools, hospitals, SACCOs, government, retail, and developers.",
};

const PLANS = [
  { name: "Free", price: "0 KES", note: "2 users · 200 messages/mo · 1 connector — real, risk-free validation." },
  { name: "Professional", price: "4,900 KES/mo", note: "15 users · 10,000 messages/mo · 10 connectors — most orgs' first paid tier." },
  { name: "Business", price: "19,900 KES/mo", note: "60 users · 100,000 messages/mo · 50 connectors — real scale." },
  { name: "Enterprise", price: "Custom", note: "No fixed ceiling, white-label, negotiated for institutional/government scale." },
];

const PROCESS_STEPS = [
  { n: "1", t: "They message your number", d: "WhatsApp, Messenger, Telegram, email, or the widget on your site — wherever they already are." },
  { n: "2", t: "P2Less identifies & verifies them", d: "Checks who's asking and what they're allowed to see, before anything sensitive moves." },
  { n: "3", t: "It calls your real systems", d: "Through the specific, permissioned connectors you configure — never free-form access." },
  { n: "4", t: "It replies — as you", d: "Your name, your number, your answer. Nobody meets P2Less. They meet you, just faster." },
];

export default async function Landing() {
  const numbers = await db.whatsAppNumber.findMany({ where: { status: "active" }, include: { tenant: true } });
  const industries = Array.from(new Set(numbers.map((n) => n.tenant.industry)));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line-soft bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <nav className="hidden items-center gap-5 text-sm text-muted lg:flex">
            <a href="#channels" className="hover:text-ink">Channels</a>
            <a href="#automation" className="hover:text-ink">Automation</a>
            <a href="#audience" className="hover:text-ink">Who it's for</a>
            <a href="#security" className="hover:text-ink">Security</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
          </nav>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/login" className="rounded-lg px-3 py-1.5 text-muted hover:text-ink">Dashboard</Link>
            <Link href="/demo" className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-surface-2">Open the demo</Link>
            <Link href="/onboard" className="rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3.5 py-1.5 font-medium text-white shadow-[var(--shadow-accent-glow)] hover:opacity-90">Start free</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        {/* HERO */}
        <section className="grid items-center gap-10 py-14 lg:grid-cols-2 lg:py-20">
          <div className="animate-in">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
              Built on the number you already have — not a new app
            </div>
            <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.1] sm:text-5xl">
              Your customers already message you.<br />
              <span className="text-accent">Make that message answer itself.</span>
            </h1>
            <p className="mt-4 max-w-md text-muted">
              P2Less sits quietly behind the WhatsApp number, Facebook Page, Telegram bot, or website you already
              have. It checks who&apos;s asking, looks into your real systems, and replies — in your name, as your
              organization. <strong className="text-ink">Nobody meets P2Less. They meet you, just faster.</strong>
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/demo" className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 font-medium text-white shadow-[var(--shadow-accent-glow)] hover:opacity-90">Message a live organization →</Link>
              <Link href="/onboard" className="rounded-xl border border-line bg-surface px-5 py-2.5 font-medium hover:bg-surface-2">Start free — it&apos;s yours in minutes</Link>
            </div>
            {industries.length > 0 && (
              <p className="mt-4 text-xs text-faint">Already answering live across {industries.length} different industries in our sandbox — try it below.</p>
            )}
          </div>

          <div className="animate-in rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-faint">
              <span className="h-2 w-2 rounded-full bg-green" /> A real conversation, right now
            </div>
            <div className="space-y-2.5">
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-accent px-3.5 py-2.5 text-sm text-white">Send me my payslip.</div>
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface-2 px-3.5 py-2.5 text-sm">Sure — I&apos;ll need to verify it&apos;s you first. I&apos;ve sent a 6-digit code to your registered number.</div>
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-accent px-3.5 py-2.5 text-sm text-white">482913</div>
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface-2 px-3.5 py-2.5 text-sm">Verified. Here&apos;s your payslip for August 2026 📄 — anything else?</div>
            </div>
            <p className="mt-3 text-center text-xs text-faint">↘ this same assistant is live in the corner of this page</p>
          </div>
        </section>

        {/* PROBLEM */}
        <section className="py-10">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">The problem every growing organization hits</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">The same handful of questions, over and over — and no good way to answer them outside office hours without hiring for it.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-line bg-surface p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">Without P2Less</div>
              <ul className="mt-3 space-y-2.5 text-sm text-muted">
                <li>Callers wait on hold for a question you answer the same way every time</li>
                <li>Staff retype the same answer dozens of times a day</li>
                <li>After 5pm and on weekends: silence</li>
                <li>Sensitive records shared over insecure channels, or not at all</li>
                <li>Every new system means another login for your team</li>
              </ul>
            </div>
            <div className="rounded-3xl border border-accent/25 bg-accent-soft p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-accent-ink">With P2Less</div>
              <ul className="mt-3 space-y-2.5 text-sm text-ink">
                <li>Answered instantly, day or night, from your own number</li>
                <li>The repeat questions handle themselves — your team handles what&apos;s actually new</li>
                <li>Real records released only after verifying who&apos;s asking</li>
                <li>One number your customers already trust. No new app to learn</li>
                <li>You stay in control — P2Less only acts within what you configure</li>
              </ul>
            </div>
          </div>
        </section>

        {/* CHANNELS */}
        <section id="channels" className="py-10">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">Wherever your customers already are</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">One assistant. Same knowledge, same rules, every channel — set up once.</p>
          <div className="mt-8">
            <ChannelBadges channels={CHANNELS} />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="py-10">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">How it actually works</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PROCESS_STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl border border-line bg-surface p-5">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] font-display text-sm font-bold text-white">{s.n}</div>
                <div className="mt-3 font-semibold">{s.t}</div>
                <div className="mt-1 text-sm text-muted">{s.d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* AUTOMATION DEEP-DIVE */}
        <section id="automation" className="py-10">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">Automation, not just answers</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">This isn&apos;t a FAQ bot. It takes real actions on your real systems — the way your own staff already would, just automatically.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AUTOMATION_EXAMPLES.map((ex) => (
              <div key={ex.title} className="rounded-2xl border border-line bg-surface p-5">
                <div className="font-semibold">{ex.title}</div>
                <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
                  <div className="text-xs font-medium text-faint">{ex.who}</div>
                  <div className="mt-0.5 italic">&ldquo;{ex.says}&rdquo;</div>
                </div>
                <div className="mt-2.5 flex gap-2 text-sm text-muted"><span className="text-accent">→</span><span>{ex.does}</span></div>
              </div>
            ))}
          </div>
        </section>

        {/* AUDIENCE */}
        <section id="audience" className="py-12">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">One platform. Every kind of organization.</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">Chatbot & automation, built around what each kind of organization actually needs.</p>
          <div className="mt-8">
            <AudienceOrbit audiences={AUDIENCES} />
          </div>
          <div className="mt-10">
            <AudienceTabs audiences={AUDIENCES} />
          </div>
        </section>

        {/* SECURITY */}
        <section id="security" className="py-12">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">Security you can verify, not just trust</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">This handles your customers&apos; real information. Here&apos;s exactly how it&apos;s protected — no vague promises.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Your data, isolated", "Every organization is a separate tenant. Your conversations, contacts, and connectors are never visible to another organization."],
              ["Role-based, branch-scoped access", "Staff only ever see what their role and branch allow — not an all-or-nothing account."],
              ["Step-up verification", "A one-time code confirms who's asking before any payslip, result, or medical record is ever released."],
              ["Controlled connectors", "P2Less calls only the specific, permissioned actions you configure. Never free-form access to your database."],
              ["Encrypted credentials", "Credentials for your connected systems are encrypted at rest — never exposed in logs or dashboards."],
              ["A real audit trail", "Every privileged action is recorded — nothing happens silently."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-line bg-surface p-5">
                <div className="font-semibold">{t}</div>
                <div className="mt-1 text-sm text-muted">{d}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-3xl border border-indigo/20 bg-indigo-soft p-6">
            <div className="font-semibold text-indigo">The assistant never invents an answer</div>
            <p className="mt-1 text-sm text-ink">It only ever responds from your own approved FAQs, your connected systems&apos; real data, or a live handoff to your staff. If it genuinely doesn&apos;t know, it says so.</p>
          </div>
          <div className="mt-4 rounded-3xl border border-line bg-surface-2 p-6 text-sm text-muted">
            <div className="font-semibold text-ink">Registered in Kenya, held to Kenya&apos;s law</div>
            <p className="mt-1">
              Hamzone Technologies, the company behind P2Less, is a duly registered Kenyan company (Certificate of
              Incorporation, Business Registration Service). Every part of the platform is built around the core
              principles of Kenya&apos;s Data Protection Act, 2019 — data minimization, purpose limitation, and real
              security safeguards — and formal registration with the Office of the Data Protection Commissioner
              (ODPC) is currently underway.
            </p>
          </div>
        </section>

        {/* TRY IT YOURSELF */}
        <section className="py-12 text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Try it right now — no signup</h2>
          <p className="mx-auto mt-2 max-w-xl text-muted">
            The chat bubble in the corner of this page is a real, live P2Less assistant — the same product your
            customers would use. Ask it anything.
          </p>
          <div className="mt-6">
            <Link href="/demo" className="inline-flex rounded-xl border border-line bg-surface px-5 py-2.5 font-medium hover:bg-surface-2">Prefer WhatsApp? Message a real demo organization →</Link>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="py-12">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">Simple, honest pricing</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">A flat monthly fee, plus a small cost for what you actually use. Free to start — we verify a card with a $0 authorization, never charged.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((p) => (
              <div key={p.name} className="rounded-2xl border border-line bg-surface p-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-faint">{p.name}</div>
                <div className="mt-1 font-display text-xl font-bold">{p.price}</div>
                <div className="mt-2 text-sm text-muted">{p.note}</div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-12">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">Questions, answered honestly</h2>
          <div className="mx-auto mt-8 max-w-2xl">
            <FaqAccordion faqs={LANDING_FAQS} />
          </div>
        </section>
      </main>

      <footer className="border-t border-line-soft">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Logo />
            <div className="flex gap-5 text-sm text-muted">
              <Link href="/privacy" className="hover:text-ink">Privacy</Link>
              <Link href="/terms" className="hover:text-ink">Terms</Link>
              <Link href="/demo" className="hover:text-ink">Demo</Link>
              <Link href="/onboard" className="hover:text-ink">Start free</Link>
            </div>
          </div>
          <p className="mt-6 text-xs text-faint">
            P2Less is a product of Hamzone Technologies, a registered Kenyan company. One organization&apos;s own
            number. One conversation. Every system behind it, answering as you.
          </p>
        </div>
      </footer>

      <script src="/widget.js" async data-key="wk_p2less_official" data-name="P2Less Assistant" data-initials="P2" data-color="#0d9488" />
    </div>
  );
}
