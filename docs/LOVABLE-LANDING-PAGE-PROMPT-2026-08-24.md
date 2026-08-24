# Prompt for Lovable — new, standalone landing page build

**Context, not part of the prompt itself**: Lovable can't connect to or import our existing repo (confirmed against their own docs — export-only, one direction). So this builds a fresh landing page in Lovable's own sandbox, using the REAL content below as source of truth. Once it's done, it gets manually ported into the real app (`src/app/page.tsx` and friends) and reviewed — nothing here touches production directly. Superseding the earlier "don't break the existing page" version of this doc, since there's no existing page in Lovable's world to break.

**One content correction already applied below, worth knowing about**: the original site's copy claimed products "automatically post to Facebook and Instagram" — real, shipped code, but the actual Meta permissions it needs were never granted (confirmed live in Meta's dashboard 2026-08-24), so it can't function yet. Softened below to describe it honestly as a real, built capability pending approval, rather than carrying the overclaim into a fresh build.

---

## Paste everything below this line into Lovable

You're building a landing page for **P2Less** — a real, working B2B SaaS product, not a mockup or a template exercise. Read the whole brief before starting.

### What P2Less actually is

*One-line pitch*: Organizations already have a WhatsApp number, a Facebook Page, a Telegram bot, an email address, or a website — P2Less sits behind whichever one they already use, verifies who's messaging, calls their real backend systems, and replies as them. Their customers never see or know about P2Less; they just get a fast, accurate answer from the organization itself.

*Audience*: schools, hospitals, SACCOs/cooperatives, government bodies, retail/business, and developers building on the platform's API. This should read as trustworthy B2B infrastructure — think "the software behind the number," not a flashy consumer app. Professional, credible, calm confidence — not hype, not gimmicks.

### Design freedom — this means structure too, not just color

You have full creative control over color palette, typography, visual style, section ORDER, section GROUPING, and how each idea gets presented. Don't default to the standard SaaS template shape (hero → problem/solution → feature grid → pricing → FAQ, stacked top to bottom, one card style repeated everywhere). Actually rethink it: What's the strongest way to open? Does "who it's for" work better woven through the page instead of one big block? Could two of these ideas share one visual moment instead of being separate sections? Is a stacked-cards grid even the right device for this content, or would something else (a comparison table, an annotated diagram, a horizontal scroller, alternating asymmetric rows) tell the story better?

Design this as if it's a genuine visual refresh for a serious institutional-trade SaaS product (schools, hospitals, government are real customers here — it should feel like something a hospital administrator or school principal would trust). Pick a palette and type pairing that earns that trust; avoid the generic "AI startup" look (a single accent-color-on-white gradient hero, an emoji-decorated feature grid, Inter/Space Grotesk as a safe default, everything centered, a rounded card with an accent-bar for every single idea).

### The content — an inventory, not a wireframe

Everything below is real information that needs to appear somewhere on the page, told accurately. **Treat this as raw material, not a section-by-section spec.** Group it, reorder it, cut a list down to its strongest points, or blend two ideas into one moment — whatever makes the strongest page. Don't render this as "one section per bullet-group below, in this order."

**What P2Less is**: Organizations already have a WhatsApp number, a Facebook Page, a Telegram bot, an email address, or a website — P2Less sits behind whichever one they already use, verifies who's messaging, calls their real backend systems, and replies as them. Their customers never see or know about P2Less; they just get a fast, accurate answer from the organization itself. Nobody meets P2Less. They meet the organization, just faster.

**A real example exchange**:
User: "Send me my payslip." → Assistant: "Sure — I'll need to verify it's you first. I've sent a 6-digit code to your registered number." → User: "482913" → Assistant: "Verified. Here's your payslip for August 2026 📄 — anything else?" This same assistant is genuinely live in the corner of the real page.

**The problem, without P2Less**: Callers wait on hold for a question answered the same way every time. Staff retype the same answer dozens of times a day. After 5pm and weekends: silence. Sensitive records shared over insecure channels, or not at all. Every new system means another login for the team.

**With P2Less**: Answered instantly, day or night, from the org's own number. Repeat questions handle themselves; staff handle what's actually new. Real records released only after verifying who's asking. One number customers already trust, nothing new to learn. The organization stays in control — P2Less only acts within what's configured.

**Channels it runs on**: WhatsApp, Facebook Messenger, Telegram, Email, and a website chat widget — all genuinely live today. X/Twitter is a real, named "coming soon," not live yet — should read as honestly upcoming, not equal to the live ones.

**How it actually works, as a real sequence**: someone messages the org's number on whichever channel they already use → P2Less checks who's asking and what they're allowed to see, before anything sensitive moves → it calls the org's real backend systems through specific, permissioned connectors, never free-form access → it replies as the organization, in their name and number.

**It takes real actions, not just answers** — genuine examples: a patient asks "Can I get an appointment this week?" and P2Less checks the hospital's real schedule, books the open slot, confirms it, no receptionist involved. An employee asks for two days off and it submits the real HR request and confirms the remaining balance. A customer asks "where's my order?" and gets the real retail-system status instantly, any time. An employee asks for their payslip, verifies with a one-time code, and gets the real document generated and sent. An organization adds a product and — once Meta's own approval for this specific integration clears (a real, built capability, currently pending that approval, not yet live for every org) — it can auto-post to their Facebook Page and Instagram.

**Who actually uses it, and what matters to each** (five real segments):
- *Retail & business*: tired of answering "where's my order" all day, and of a new product meaning a manual social post. Gets real order status instantly, product-adds that can auto-publish once connected, M-Pesa-aware payment conversations, delivery dispatch that offers a trip to a real driver.
- *Schools & hospitals*: parents/patients calling for the same handful of answers, silence after hours. Gets grounded FAQ answers staff actually approved, real records (results, appointments, payslips) released only after verification, multiple branches/campuses correctly routed under one number.
- *SACCOs & cooperatives*: members across branches needing the same self-service, a core system not built for chat. Gets one number spanning many correctly-scoped branches, connects to the existing core system rather than replacing it, member self-service for balances/statements, every action logged for the board.
- *Government*: public services needing to scale without losing who-can-see-what or the paper trail. Gets a full audit trail, role-based access by branch/department, encrypted credentials, custom Enterprise pricing.
- *Developers*: wiring a chat interface to a real backend usually means weeks of integration work. Gets an OpenAPI-spec-to-working-connector pipeline, a marketplace of ready templates, every capability risk-tiered and permission-gated by design, API keys and webhooks on the same engine powering every channel.

**Security, in real, verifiable terms, not vague promises**: every organization is a fully isolated tenant, never visible to another. Access is role-based and branch-scoped, not all-or-nothing. A one-time step-up code is required before any payslip, result, or medical record is ever released. Connectors only ever call specific, permissioned actions — never free-form database access. Credentials are encrypted at rest, never exposed in logs. Every privileged action is recorded in a real audit trail. The assistant never invents an answer — it only responds from approved FAQs, real connected-system data, or a live handoff to staff; if it doesn't know, it says so. Hamzone Technologies (the company behind P2Less) is a duly registered Kenyan company; formal registration with Kenya's Data Protection Commissioner is underway.

**Pricing, real numbers**: Free — 0 KES, 2 users, 200 messages/mo, 1 connector. Professional — 4,900 KES/mo, 15 users, 10,000 messages/mo, 10 connectors. Business — 19,900 KES/mo, 60 users, 100,000 messages/mo, 50 connectors. Enterprise — custom, no fixed ceiling, negotiated. Free to start, a $0 card authorization to verify, never charged unless upgraded.

**FAQ material** — the real list runs to about 25-30 questions; whatever pattern you design needs to hold up at that scale, not just look good with five. Representative examples: "Do my customers need to install an app?" (No — they message the number they already have). "Is our data isolated from other organizations?" (Yes, every org is a separate tenant). "Does the assistant ever make things up?" (No — only from approved FAQs, real system data, or a human handoff). "How many customers do you have?" (Honestly newly launched — real working software, no public customer count yet). "Which AI model powers this?" (Not tied to one vendor — automatic failover across several providers). "Is there a contract?" (Month-to-month on Free/Professional/Business, Enterprise negotiated).

**Navigation and CTAs that need to exist somewhere**: a way to reach the demo ("Message a live organization" / "Open the demo"), a way to sign up ("Start free — it's yours in minutes"), a link to the dashboard/login for existing customers, and the footer needs Privacy/Terms/Demo/Start-free links plus: "P2Less is a product of Hamzone Technologies, a registered Kenyan company."

### You can go further than the list above — genuinely

The content above is the floor, not the ceiling. If you have a better idea for a section, a moment, an interaction, an illustration, a way of explaining something that isn't in the list at all — add it. New sections, new visual metaphors, new micro-interactions, new ways of demonstrating the product, anything you think makes this a stronger, more memorable page. This is a real creative brief, not a fill-in-the-blanks template. Nothing here is purely visual/static-only in a way that limits you — treat it as a genuine open canvas.

Two real rules, not creative limits, just honesty ones:
1. **Don't remove or contradict the real facts already given** (the pricing numbers, the security claims, what's live vs. coming soon, the honest "newly launched, no track record yet" tone). Add to this, don't erase it.
2. **If you invent a new feature or capability that doesn't exist yet**, that's genuinely welcome as a creative/product idea — just don't present it as something that already works today (no "10,000 happy customers," no fabricated stats, no claiming a new feature is live). Frame new ideas as new ideas. We'll look at everything you propose and decide what's worth actually building for real — a good idea here can become a real, shipped feature, not just a mockup.

There's no real backend behind this build (it's a standalone design in your own sandbox) — so nothing you design can accidentally break anything; the riskiest thing that can happen is we love an idea and build it for real afterward. Design accordingly — be bold.

### Requirements

1. **Fully responsive** — clean on real mobile widths (375px and up), tablet, and desktop. No horizontal scroll anywhere. Comfortable touch targets on mobile. Readable text at every size.
2. **Beautiful, professional, credible** — this is the top priority. Elevate typography, spacing, hierarchy, and section flow well beyond a generic template.
3. Check your own result at mobile (375px), tablet (768px), and desktop (1440px) widths before calling it done.

### Before you finish

Write a clear summary of your design decisions — palette choice and why, typeface pairing and why, any layout patterns you're particularly proud of, and anything you'd want a developer to know before porting this into a real Next.js + Tailwind codebase (e.g. "the pricing cards use a CSS grid with X," "the FAQ accordion uses Y library/pattern"). Also call out specifically **anything you added that wasn't in the content list above** — new sections, new ideas, new copy angles — so it's easy to tell "from the brief" apart from "your own creative addition" during review. This gets reviewed before anything is merged into or built for the real app, so be specific and accurate.
