# Prompt for Lovable — new, standalone landing page build

**Context, not part of the prompt itself**: Lovable can't connect to or import our existing repo (confirmed against their own docs — export-only, one direction). So this builds a fresh landing page in Lovable's own sandbox, using the REAL content below as source of truth. Once it's done, it gets manually ported into the real app (`src/app/page.tsx` and friends) and reviewed — nothing here touches production directly. Superseding the earlier "don't break the existing page" version of this doc, since there's no existing page in Lovable's world to break.

**One content correction already applied below, worth knowing about**: the original site's copy claimed products "automatically post to Facebook and Instagram" — real, shipped code, but the actual Meta permissions it needs were never granted (confirmed live in Meta's dashboard 2026-08-24), so it can't function yet. Softened below to describe it honestly as a real, built capability pending approval, rather than carrying the overclaim into a fresh build.

---

## Paste everything below this line into Lovable

You're building a landing page for **P2Less** — a real, working B2B SaaS product, not a mockup or a template exercise. Read the whole brief before starting.

### What P2Less actually is

*One-line pitch*: Organizations already have a WhatsApp number, a Facebook Page, a Telegram bot, an email address, or a website — P2Less sits behind whichever one they already use, verifies who's messaging, calls their real backend systems, and replies as them. Their customers never see or know about P2Less; they just get a fast, accurate answer from the organization itself.

*Audience*: schools, hospitals, SACCOs/cooperatives, government bodies, retail/business, and developers building on the platform's API. This should read as trustworthy B2B infrastructure — think "the software behind the number," not a flashy consumer app. Professional, credible, calm confidence — not hype, not gimmicks.

### Design freedom

You have full creative control over color palette, typography, and visual style — don't try to guess or match an existing brand. Design this as if it's a genuine visual refresh for a serious institutional-trade SaaS product (schools, hospitals, government are real customers here — the design should feel like something a hospital administrator or school principal would trust). Pick a palette and type pairing that earns that trust; avoid the generic "AI startup" look (a single accent-color-on-white gradient hero, an emoji-decorated feature grid, Inter/Space Grotesk as a safe default).

### Required sections and their real content

**1. Header/nav**: Logo/wordmark "P2Less". Nav links: Channels, Automation, Who it's for, Security, Pricing, FAQ. Right side: a "Dashboard" text link, an "Open the demo" secondary button, and a "Start free" primary CTA button.

**2. Hero**
- Eyebrow tag: "Built on the number you already have — not a new app"
- Headline: "Your customers already message you. **Make that message answer itself.**"
- Subhead: "P2Less sits quietly behind the WhatsApp number, Facebook Page, Telegram bot, or website you already have. It checks who's asking, looks into your real systems, and replies — in your name, as your organization. **Nobody meets P2Less. They meet you, just faster.**"
- Two CTAs: "Message a live organization →" (primary) and "Start free — it's yours in minutes" (secondary)
- A small live-stat line: "Already answering live across 3 different industries in our sandbox — try it below." (this number is real and dynamic in production; just design the space for it)
- A visual centerpiece: a stylized chat-conversation mockup showing a real example exchange:
  - User: "Send me my payslip."
  - Assistant: "Sure — I'll need to verify it's you first. I've sent a 6-digit code to your registered number."
  - User: "482913"
  - Assistant: "Verified. Here's your payslip for August 2026 📄 — anything else?"
  - Caption beneath it: "↘ this same assistant is live in the corner of this page"

**3. Problem/solution** — two-column comparison, "Without P2Less" vs "With P2Less":
- Without: Callers wait on hold for a question you answer the same way every time · Staff retype the same answer dozens of times a day · After 5pm and on weekends: silence · Sensitive records shared over insecure channels, or not at all · Every new system means another login for your team
- With: Answered instantly, day or night, from your own number · The repeat questions handle themselves — your team handles what's actually new · Real records released only after verifying who's asking · One number your customers already trust. No new app to learn · You stay in control — P2Less only acts within what you configure

**4. Channels** — "Wherever your customers already are." One assistant, same knowledge, same rules, every channel, set up once. Six channel badges: WhatsApp (live), Messenger (live), Telegram (live), Email (live), Website widget (live), X/Twitter (marked "soon", not live yet — visually distinguish this one as upcoming).

**5. How it works** — 4 numbered steps: (1) They message your number — WhatsApp, Messenger, Telegram, email, or the widget on your site. (2) P2Less identifies & verifies them — checks who's asking and what they're allowed to see. (3) It calls your real systems — through specific, permissioned connectors, never free-form access. (4) It replies — as you — your name, your number, your answer.

**6. Automation examples** — "Automation, not just answers" — this isn't a FAQ bot, it takes real actions. Show as example cards (who asked → what they said → what happened):
- Patient: "Can I get an appointment this week?" → Checks the hospital's real schedule, books the open slot, and confirms it — no receptionist involved.
- Employee: "I need Monday and Tuesday off." → Submits the request to the real HR system and confirms the remaining balance.
- Customer: "Where's my order?" → Looks up the real status from the retail system and replies instantly, any time of day.
- Employee: "Send me my payslip." → After a one-time verification code, generates the real payslip from the payroll system and sends it.
- The organization adds a product to their catalog → Posts it to the organization's Facebook Page and Instagram once connected — a real, built capability currently pending Meta's own approval process, not yet live for every organization.

**7. Who it's for** — 5 audience segments, each with a headline, a pain point, and capability bullets. Design this as either tabs, an interactive selector, or distinct cards — your call on the best pattern:
- **Retail & Business** — "Customers ask 'where's my order' a hundred times a day, and every new product means another manual social media post." → Real order status from your own retail system, answered instantly · Add a product once, publish it to your Facebook Page and Instagram once connected · M-Pesa-aware conversations for payments and confirmations · Delivery dispatch that offers a trip to a real driver and tracks the reply
- **Schools & Hospitals** — "Parents and patients call the front office for the same handful of answers, and after-hours means silence." → Grounded answers to fees, term dates, visiting hours, from FAQs staff actually approved · Real records (exam results, appointments, payslips) released only after a one-time verification code · Multiple branches or campuses under one number, correctly routed · Answers day or night, without a single extra staff member
- **SACCOs & Cooperatives** — "Members across many branches all need the same self-service, and your core system wasn't built for chat." → One number, many branches, each correctly scoped · Connects to your existing core system rather than replacing it · Member self-service for balances and statements, verified before anything sensitive is shared · Every action logged for the board
- **Government** — "Public-facing services need to scale without compromising who can see what, or losing the paper trail." → Full audit trail on every privileged action · Role-based access scoped by branch or department · Encrypted credentials, isolated tenant data, step-up verification · Custom-priced Enterprise deployment
- **Developers** — "Wiring a chat interface to a real backend usually means weeks of custom integration work." → Paste an OpenAPI spec, get working permission-scoped connectors drafted for review · A curated marketplace of ready-made connector templates · Every capability risk-tiered and permission-gated by design · API keys and webhooks to build on the same engine

**8. Security** — "Security you can verify, not just trust." Six cards: Your data, isolated (every organization is a separate tenant, never visible to another) · Role-based, branch-scoped access · Step-up verification (a one-time code before any payslip, result, or medical record is released) · Controlled connectors (only specific, permissioned actions, never free-form database access) · Encrypted credentials (never exposed in logs or dashboards) · A real audit trail (every privileged action recorded). Plus a callout: "The assistant never invents an answer — it only ever responds from approved FAQs, real connected-system data, or a live handoff to staff." Plus a smaller note: "Registered in Kenya, held to Kenya's law — Hamzone Technologies is a duly registered Kenyan company; formal registration with Kenya's Data Protection Commissioner is underway."

**9. "Try it yourself"** — a short CTA section: "The chat bubble in the corner of this page is a real, live P2Less assistant — ask it anything." Link: "Prefer WhatsApp? Message a real demo organization →"

**10. Pricing** — "Simple, honest pricing." A flat monthly fee plus small usage costs, free to start with a $0 card authorization, never charged unless upgraded. Four tiers as cards:
- Free — 0 KES — 2 users · 200 messages/mo · 1 connector
- Professional — 4,900 KES/mo — 15 users · 10,000 messages/mo · 10 connectors
- Business — 19,900 KES/mo — 60 users · 100,000 messages/mo · 50 connectors
- Enterprise — Custom — no fixed ceiling, white-label, negotiated

**11. FAQ** — "Questions, answered honestly." An accordion. Design it to scale to ~25-30 questions (the real list is longer than what's below — build a clean, scannable pattern, not one that only looks good with 5 items). Representative sample to design against:
- "Do my customers need to install an app?" → No. They message the number they already have.
- "Is our data isolated from other organizations on P2Less?" → Yes, every organization is a separate tenant.
- "Does the assistant ever make things up?" → No — it only answers from approved FAQs, real system data, or a human handoff.
- "How many customers/clients do you have?" → We're honest that P2Less is newly launched — real working software, not a mockup, but no public customer count yet.
- "Which AI model or company powers the assistant?" → Not tied to one vendor — automatic failover across several major AI providers for reliability.
- "Is there a contract, or can I cancel anytime?" → Free/Professional/Business are month-to-month, cancel anytime. Enterprise is negotiated.

**12. Footer** — Logo, links (Privacy, Terms, Demo, Start free), and the line: "P2Less is a product of Hamzone Technologies, a registered Kenyan company. One organization's own number. One conversation. Every system behind it, answering as you."

### What NOT to build

- No real backend, database, or API calls — this is a static, standalone design. Where the real product has live/dynamic data (the industries count, the chat widget), just design the visual space for it — I'll wire the real functionality back in myself during the merge.
- Don't invent new feature claims, new pricing numbers, or new sections beyond what's listed above.
- Don't fabricate customer logos, testimonials, or review scores — this product is honestly newly launched and doesn't have those yet; don't paper over that.

### Requirements

1. **Fully responsive** — clean on real mobile widths (375px and up), tablet, and desktop. No horizontal scroll anywhere. Comfortable touch targets on mobile. Readable text at every size.
2. **Beautiful, professional, credible** — this is the top priority. Elevate typography, spacing, hierarchy, and section flow well beyond a generic template.
3. Check your own result at mobile (375px), tablet (768px), and desktop (1440px) widths before calling it done.

### Before you finish

Write a clear summary of your design decisions — palette choice and why, typeface pairing and why, any layout patterns you're particularly proud of, and anything you'd want a developer to know before porting this into a real Next.js + Tailwind codebase (e.g. "the pricing cards use a CSS grid with X," "the FAQ accordion uses Y library/pattern"). This gets reviewed before anything is merged into the real app, so be specific and accurate.
