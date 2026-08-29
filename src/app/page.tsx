import type { Metadata } from "next";
import Link from "next/link";
import { getSetting } from "@/lib/platform-settings";
import { Logo } from "@/components/ui";
import { SiteHeader } from "./site-header";
import { AudienceOrbit } from "./audience-orbit";
import { AudienceTabs } from "./audience-tabs";
import { ChannelBadges } from "./channel-badges";
import { FaqAccordion } from "./faq-accordion";
import { AutomationCards } from "./automation-cards";
import { ChannelChatMockup } from "./channel-chat-mockup";
import { LANDING_FAQS, AUDIENCES, CHANNELS, AUTOMATION_EXAMPLES } from "@/lib/landing-content";

// Queries the DB for real (aggregate-only) stats, so it must render
// per-request, not be statically prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "P2Less: WhatsApp Chatbot and Automation for Schools, Hospitals, SACCOs, Government and Business",
  description:
    "Turn the WhatsApp number, Facebook Page, Telegram bot, or website you already have into a real assistant. It verifies who's asking, calls your actual systems, and replies as you. Built for schools, hospitals, SACCOs, government, retail, and developers.",
};

// Free: a real 7-day trial (Subscription.trialEndsAt), not a permanent free
// tier — see prepaid-billing.ts's isGateExempt()/getUsageSummary(). Real gap
// found and fixed 2026-08-27: Starter existed as a real Plan row (used by
// Billing's own upgrade flow) but had never been added here — this page
// only ever showed Free/Professional/Business/Enterprise.
const PLANS = [
  {
    name: "Free", price: "0", unit: "KES/mo", tagline: "A real 7-day trial, no card required.",
    features: ["2 users", "200 messages/mo", "1 connector"], highlight: false,
  },
  {
    name: "Starter", price: "1,500", unit: "KES/mo", tagline: "Your first paid tier.",
    features: ["5 users", "2,000 messages/mo", "3 connectors"], highlight: false,
  },
  {
    name: "Professional", price: "4,900", unit: "KES/mo", tagline: "Most orgs land here.",
    features: ["15 users", "10,000 messages/mo", "10 connectors"], highlight: true,
  },
  {
    name: "Business", price: "19,900", unit: "KES/mo", tagline: "Real scale.",
    features: ["60 users", "100,000 messages/mo", "50 connectors"], highlight: false,
  },
  {
    name: "Enterprise", price: "Custom", unit: "", tagline: "Negotiated for institutional and government scale.",
    features: ["No fixed ceiling", "White-label", "Dedicated terms"], highlight: false,
  },
];

// Same brand-silhouette convention as channel-badges.tsx's ICON_PATHS —
// recognizable glyphs, not scraped/official assets. Real Hamzone Technologies
// contact channels, not placeholders: WhatsApp/phone +254711562526 (the
// number Meta itself verified during WhatsApp Business Verification),
// Messenger via the connected "Hamzone Technologies LTD" Page (828105030394804).
const FOOTER_ICON_PATHS = {
  whatsapp:
    "M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.07-1.33A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18a7.9 7.9 0 0 1-4.24-1.23l-.3-.19-3.05.8.82-2.97-.2-.31A7.94 7.94 0 1 1 12 20zm4.36-5.85c-.23-.12-1.38-.68-1.6-.76-.21-.08-.37-.12-.53.12-.15.23-.6.76-.74.92-.14.15-.27.17-.5.06-.23-.12-.98-.36-1.87-1.15-.69-.62-1.16-1.38-1.3-1.61-.13-.23-.01-.36.1-.47.11-.11.23-.27.35-.41.11-.14.15-.23.23-.39.08-.15.04-.29-.02-.41-.06-.12-.53-1.28-.73-1.75-.19-.46-.39-.4-.53-.4-.14-.01-.29-.01-.45-.01-.15 0-.4.06-.61.29-.21.23-.8.78-.8 1.9s.82 2.2.93 2.36c.12.15 1.62 2.47 3.92 3.47.55.24.98.38 1.31.48.55.18 1.05.15 1.45.09.44-.07 1.38-.57 1.57-1.11.19-.55.19-1.02.14-1.11-.06-.1-.21-.16-.44-.27z",
  messenger:
    "M12 2C6.5 2 2 6.15 2 11.5c0 3.05 1.47 5.77 3.78 7.55V22l3.45-1.9c.9.25 1.85.38 2.77.38 5.5 0 10-4.15 10-9.5S17.5 2 12 2zm1.02 12.79-2.55-2.72-4.98 2.72 5.48-5.82 2.61 2.72 4.9-2.72-5.46 5.82z",
  instagram:
    "M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zM12 0C8.74 0 8.33.01 7.05.07c-1.28.06-2.15.26-2.91.56-.79.31-1.46.72-2.13 1.39C1.24 2.7.83 3.37.52 4.15c-.3.76-.5 1.63-.56 2.91C-.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.28.26 2.15.56 2.91.31.79.72 1.46 1.39 2.13.67.67 1.34 1.08 2.13 1.39.76.3 1.63.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.28-.06 2.15-.26 2.91-.56.79-.31 1.46-.72 2.13-1.39.67-.67 1.08-1.34 1.39-2.13.3-.76.5-1.63.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91-.31-.79-.72-1.46-1.39-2.13C21.3 1.24 20.63.83 19.85.52c-.76-.3-1.63-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84zm0 10.16A4 4 0 1 1 12 8a4 4 0 0 1 0 8zm6.4-10.4a1.44 1.44 0 1 1 0-2.88 1.44 1.44 0 0 1 0 2.88z",
  phone:
    "M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z",
};

const PROCESS_STEPS = [
  { n: "1", t: "They message your number", d: "WhatsApp, Messenger, Telegram, email, or the widget on your site. Wherever they already are." },
  { n: "2", t: "P2Less identifies and verifies them", d: "Checks who's asking and what they're allowed to see, before anything sensitive moves." },
  { n: "3", t: "It calls your real systems", d: "Any system with an API, not a fixed list — paste an OpenAPI spec and get a working connector in minutes, or install a ready-made template. Always permissioned, never free-form access." },
  { n: "4", t: "It replies as you", d: "Your name, your number, your answer. Nobody meets P2Less. They meet you, just faster." },
];

export default async function Landing() {
  // Public Feedback / Quality Centre, Phase B (docs/PUBLIC-FEEDBACK-QUALITY-
  // CENTRE-2026-08-23.md) — admin-controlled via /admin/system-health, off
  // by default. The widget below already accepts reports either way; this
  // only controls whether the invitation is publicly advertised.
  const qualityFeedbackInvitationEnabled = (await getSetting("quality_feedback_invitation_enabled")) === "1";

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6">
        {/* HERO */}
        <section className="grid items-center gap-10 py-14 lg:grid-cols-2 lg:py-20">
          <div className="animate-in">
            <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.1] sm:text-5xl">
              Your customers already message you.<br />
              <span className="text-accent">Make that message answer itself.</span>
            </h1>
            <p className="mt-4 max-w-md text-muted">
              P2Less sits quietly behind the WhatsApp number, Facebook Page, Telegram bot, or website you already
              have. It checks who&apos;s asking, looks into your real systems, and replies in your name, as your
              organization. <strong className="text-ink">Nobody meets P2Less. They meet you, just faster.</strong>
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/demo" className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 font-medium text-white shadow-[var(--shadow-accent-glow)] hover:opacity-90">Message a live organization →</Link>
              <Link href="/onboard" className="rounded-xl border border-line bg-surface px-5 py-2.5 font-medium hover:bg-surface-2">Start free. It&apos;s yours in minutes.</Link>
            </div>
          </div>

          <div className="animate-in">
            <ChannelChatMockup />
            <p className="mt-4 text-center text-xs text-faint">↘ this same assistant is live in the corner of this page</p>
          </div>
        </section>

        {/* PROBLEM */}
        <section className="py-10">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">The problem every growing organization hits</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">The same handful of questions, over and over, with no good way to answer them outside office hours without hiring for it.</p>
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
                <li>Whether it&apos;s 1 customer or 100 messaging at once, nobody waits in line</li>
                <li>The repeat questions handle themselves. Your team handles what&apos;s actually new</li>
                <li>Real records released only after verifying who&apos;s asking</li>
                <li>One number your customers already trust. No new app to learn</li>
                <li>You stay in control. P2Less only acts within what you configure</li>
              </ul>
            </div>
          </div>
        </section>

        {/* CHANNELS */}
        <section id="channels" className="py-10">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">Wherever your customers already are</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">One assistant. Same knowledge, same rules, every channel, set up once.</p>
          <div className="mt-8">
            <ChannelBadges channels={CHANNELS} />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="py-10">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">How it actually works</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PROCESS_STEPS.map((s, i) => (
              <div key={s.n} className="animate-in group rounded-2xl border border-line bg-surface p-5 transition-all duration-300 hover:-translate-y-1 hover:border-accent/30 hover:shadow-[var(--shadow-card-hover)]" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="grid h-9 w-9 place-items-center rounded-full bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] font-display text-sm font-bold text-white transition-transform duration-300 group-hover:scale-110">{s.n}</div>
                <div className="mt-3 font-semibold">{s.t}</div>
                <div className="mt-1 text-sm text-muted">{s.d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* AUTOMATION DEEP-DIVE */}
        <section id="automation" className="py-10">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">Automation, not just answers</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">This isn&apos;t a FAQ bot. It takes real actions on your real systems, the way your own staff already would, just automatically.</p>
          <div className="mt-8">
            <AutomationCards examples={AUTOMATION_EXAMPLES} />
          </div>
        </section>

        {/* AUDIENCE */}
        <section id="audience" className="py-12">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">One platform. Every kind of organization.</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">Chatbot and automation, built around what each kind of organization actually needs.</p>
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
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">This handles your customers&apos; real information. Here&apos;s exactly how it&apos;s protected, no vague promises.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Your data, isolated", "Every organization is a separate tenant. Your conversations, contacts, and connectors are never visible to another organization."],
              ["Role-based, branch-scoped access", "Staff only ever see what their role and branch allow. Not an all-or-nothing account."],
              ["Step-up verification", "A one-time code confirms who's asking before any payslip, result, or medical record is ever released."],
              ["Controlled connectors", "P2Less calls only the specific, permissioned actions you configure. Never free-form access to your database."],
              ["Encrypted credentials", "Credentials for your connected systems are encrypted at rest. Never exposed in logs or dashboards."],
              ["A real audit trail", "Every privileged action is recorded. Nothing happens silently."],
            ].map(([t, d], i) => (
              <div key={t} className="animate-in rounded-2xl border border-line bg-surface p-5 transition-all duration-300 hover:-translate-y-1 hover:border-accent/30 hover:shadow-[var(--shadow-card-hover)]" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="font-semibold">{t}</div>
                <div className="mt-1 text-sm text-muted">{d}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 overflow-hidden rounded-3xl border border-line">
            <div className="grid sm:grid-cols-2">
              <div className="border-b border-line p-6 sm:border-b-0 sm:border-r">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo" /> No invented answers
                </div>
                <p className="mt-2 text-sm text-ink">It only ever responds from your own approved FAQs, your connected systems&apos; real data, or a live handoff to your staff. If it genuinely doesn&apos;t know, it says so.</p>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink" /> Registered in Kenya
                </div>
                <p className="mt-2 text-sm text-muted">
                  Hamzone Technologies, the company behind P2Less, is a duly registered Kenyan company (Certificate
                  of Incorporation, Business Registration Service). The platform is built around Kenya&apos;s Data
                  Protection Act, 2019: data minimization, purpose limitation, and real security safeguards.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* TRY IT YOURSELF */}
        <section className="py-12 text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">See it work, right now</h2>
          <p className="mx-auto mt-2 max-w-xl text-muted">
            The chat bubble in the corner of this page is a real, live P2Less assistant, the same product your
            customers would use. Ask it anything.
          </p>
          <div className="mt-6">
            <Link href="/demo" className="inline-flex rounded-xl border border-line bg-surface px-5 py-2.5 font-medium hover:bg-surface-2">Prefer WhatsApp? Message a real demo organization →</Link>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="py-12">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">Simple, honest pricing</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted">A flat monthly fee, plus a small cost for what you actually use. Free to start, no card required.</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {PLANS.map((p, i) => (
              <div
                key={p.name}
                className={
                  "animate-in relative flex flex-col overflow-hidden rounded-3xl border p-6 transition-all duration-300 hover:-translate-y-1 " +
                  (p.highlight
                    ? "border-accent/40 bg-[linear-gradient(180deg,var(--color-accent-soft),var(--color-surface)_60%)] shadow-[var(--shadow-accent-glow)]"
                    : "border-line bg-surface hover:border-accent/30 hover:shadow-[var(--shadow-card-hover)]")
                }
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {p.highlight && (
                  <span className="absolute right-[-34px] top-[18px] w-[140px] rotate-45 bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] py-1 text-center text-[10px] font-bold uppercase tracking-wide text-white shadow-[var(--shadow-accent-glow)]">
                    Most popular
                  </span>
                )}
                <div className="text-xs font-semibold uppercase tracking-wide text-faint">{p.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  {p.price !== "Custom" && <span className="font-display text-lg font-bold text-muted">KES</span>}
                  <span className="font-display text-3xl font-bold tracking-tight">{p.price}</span>
                  {p.unit && <span className="text-sm text-muted">/mo</span>}
                </div>
                <div className="mt-1.5 text-sm text-muted">{p.tagline}</div>
                <ul className="mt-5 space-y-2.5 border-t border-line-soft pt-5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5">
                      <span className={"grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold " + (p.highlight ? "bg-accent text-white" : "bg-accent-soft text-accent-ink")}>✓</span>
                      <span className="text-ink">{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/onboard"
                  className={
                    "mt-6 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 " +
                    (p.highlight
                      ? "bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] text-white shadow-[var(--shadow-accent-glow)]"
                      : "border border-line bg-surface text-ink")
                  }
                >
                  {p.name === "Enterprise" ? "Talk to us" : "Start free"}
                </Link>
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

        {/* Public Feedback / Quality Centre invitation — admin-controlled,
            /admin/system-health, off by default. */}
        {qualityFeedbackInvitationEnabled && (
          <section className="py-12">
            <div className="mx-auto max-w-2xl rounded-2xl border border-line bg-surface p-6 text-center">
              <h2 className="font-display text-lg font-bold tracking-tight">Try to break it.</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                If P2Less gives you something wrong, confusing, unexpected, or suspicious, tell us through the chat in the bottom-right corner — we review every report by hand before anything changes.
              </p>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-line-soft bg-surface-2">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Logo />
              <p className="mt-4 text-sm text-muted">
                One organization&apos;s own number. One conversation. Every system behind it, answering as you.
              </p>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">Product</div>
              <div className="mt-3 flex flex-col gap-2.5 text-sm text-muted">
                <a href="#channels" className="hover:text-ink">Channels</a>
                <a href="#automation" className="hover:text-ink">Automation</a>
                <a href="#pricing" className="hover:text-ink">Pricing</a>
                <Link href="/demo" className="hover:text-ink">Live demo</Link>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">Company</div>
              <div className="mt-3 flex flex-col gap-2.5 text-sm text-muted">
                <a href="https://hamzonetechnologies.com" target="_blank" rel="noopener noreferrer" className="hover:text-ink">Hamzone Technologies →</a>
                <Link href="/privacy" className="hover:text-ink">Privacy</Link>
                <Link href="/terms" className="hover:text-ink">Terms</Link>
                <Link href="/onboard" className="hover:text-ink">Start free</Link>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">Talk to us</div>
              <p className="mt-3 text-sm text-muted">
                Message us on the exact channels P2Less itself runs on. Same instant reply your own customers would get.
              </p>
              <div className="mt-4 flex items-center gap-2.5">
                <a
                  href="https://wa.me/254711562526"
                  target="_blank" rel="noopener noreferrer" title="WhatsApp"
                  className="grid h-10 w-10 place-items-center rounded-xl text-white shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5"
                  style={{ background: "#25D366" }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={FOOTER_ICON_PATHS.whatsapp} /></svg>
                </a>
                <a
                  href="https://m.me/828105030394804"
                  target="_blank" rel="noopener noreferrer" title="Messenger"
                  className="grid h-10 w-10 place-items-center rounded-xl text-white shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5"
                  style={{ background: "#0084FF" }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={FOOTER_ICON_PATHS.messenger} /></svg>
                </a>
                <span
                  title="Instagram — coming soon"
                  className="grid h-10 w-10 place-items-center rounded-xl text-white opacity-50 shadow-[var(--shadow-card)]"
                  style={{ background: "#E1306C" }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={FOOTER_ICON_PATHS.instagram} /></svg>
                </span>
                <a
                  href="tel:+254711562526"
                  title="Call us"
                  className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-ink shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={FOOTER_ICON_PATHS.phone} /></svg>
                </a>
              </div>
              <a href="tel:+254711562526" className="mt-3 block text-sm font-medium text-ink hover:text-accent">+254 711 562526</a>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-2 border-t border-line-soft pt-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
            <span>P2Less is a product of Hamzone Technologies, a registered Kenyan company.</span>
            <span>© {new Date().getFullYear()} Hamzone Technologies. All rights reserved.</span>
          </div>
        </div>
      </footer>

      <script src="/widget.js" async data-key="wk_p2less_official" data-name="P2Less Assistant" data-initials="P2L" data-color="#0d9488" data-logo="/hamzone-logo.png" />
    </div>
  );
}
