# P2Less — Project Status (goal / achieved / remaining)

**This is the one document to read first for "where are we."** Kept current every round and pushed immediately — not a snapshot that goes stale. Full reasoning, evidence, and history live in the linked docs below; this page states the current state in the fewest words that stay honest.

**On a new machine?** See [`README.md`](../README.md)'s "Lost your laptop? Start here" section — clone from GitHub, production is already live at Railway and needs no local setup, and real secrets come from `railway variables`, not from memory (`.env` is deliberately never committed).

**Worried something's broken, missing, or half-built?** [`GAP-REGISTER-2026-08-24.md`](GAP-REGISTER-2026-08-24.md) is the one current, evidence-backed list of every known gap across security, money/billing, data integrity, and missing CRUD operations — each with real status verified against actual code, not an old note. Check there first before assuming something is fine or reopening an investigation that's already been done.

---

## The goal

*"Connect your existing systems to P2Less, and P2Less gives your people one intelligent way to access information, perform actions, automate work, and communicate across those systems."*

P2Less is a universal digital access, automation, integration, AI, and communication layer — **augmentation, not replacement**. Organizations keep their existing systems (school management software, hospital records, payroll, retail order tracking, whatever they already run); P2Less connects to those systems and gives their people (staff and customers/parents/patients) one conversational way in, over WhatsApp today and other channels as they ship.

Six architectural rules held as fundamental throughout: never fabricate certainty (every fact tagged Known/Calculated/Configured/Generated/Unknown); four modes (Connect/Operate/Automate/Create); an authority gate before any autonomous action (can AI do this? is the user authorized? does it need confirmation? then execute); every action is a registered Capability with its own risk level and approval requirements, never freeform execution; cross-system data conflicts resolve by configured source-priority, never a guess; and "I cannot do that" / "I don't know" is treated as a trust feature, not a weakness to hide.

Full detail: [`VISION-UNIVERSAL-ACCESS-PLATFORM-2026-08-19.md`](VISION-UNIVERSAL-ACCESS-PLATFORM-2026-08-19.md).

---

## What's been achieved

Everything below is shipped, live-verified (not just typechecked), and deployed to production unless a line says otherwise.

**Foundation (Phases 1-3, 6)**: branch hierarchy + capability schema + provenance typing; branch-scoped routing/RBAC; the capability gate every action runs through; OpenAPI-driven connector drafting (paste a spec, review, go live) plus a platform-curated connector marketplace.

**Conversation engine**: grounded AI with 7-provider automatic failover (never fabricates — explicit Known/Generated distinction in the prompts themselves), full RBAC, hash-chained tamper-evident audit logs (per-tenant and platform-wide), OTP step-up for sensitive data with a 180-day re-verification staleness gate (both for single actions and bundled overviews), conversational CRUD (book/reschedule/cancel), workflow-engine primitive live on 9 of 9 quantified conversation states.

**Channels — live today**: WhatsApp (the original channel) and the embeddable website widget. **Built, needs one real-world step to prove the round-trip**: Facebook Messenger — now handles media attachments and postback buttons too (2026-08-24), not just text; a real Page is connected in production, still needs a Meta App Tester invite accepted to prove a real inbound round-trip — Telegram (needs a real `@BotFather` token), Email via Resend Inbound (needs the Resend dashboard configured). **Not started**: Instagram DMs (blocked on Meta App Review), WhatsApp self-service onboarding for other tenants (Phase 9, paused on a spare test number).

**Registration & data model**: `useCases`/`channelsNeeded` capture what an org actually wants at signup (not sector-only); capability-based dashboard navigation shows only what's relevant to what a tenant actually uses.

**Security hardening**: structural tenant isolation (an ORM-level Prisma extension auto-scoping all 27 tenant-scoped models, AsyncLocalStorage-backed) — now genuinely fail-closed in production, not just warn-only. 2026-08-24: found and fixed the REAL reason the fail-closed version broke production before — not "RSC doesn't propagate context" (that theory was wrong), but that a guard function setting context and then *returning* a value never survives, even in Route Handlers; the fix is guard-and-invoke wrapper functions (`withTenantUser`, `withAdminPermission`, etc.) instead of guard-then-continue. Every real dashboard and admin entry point converted and verified via direct reproduction under a real `next build && next start`. Deployed warn-only first, watched real production traffic for a clean window, then flipped `db.ts` back to a real throw — re-verified the same rigorous way before that final deploy too. See [`GAP-REGISTER-2026-08-24.md`](GAP-REGISTER-2026-08-24.md) item 1 for the full story. SSRF guard shared across every server-side fetch of a tenant-supplied URL, with IP-pinning closing a DNS-rebinding TOCTOU window (2026-08-24); `CREDENTIAL_KEY` rotated from a guessable placeholder to a real random key; five trial-abuse hardening items on `/onboard` (email canonicalization, signup rate-limiting, real phone OTP, admin anomaly alerts, Stripe card-on-file); real WhatsApp Cloud API token-health monitoring (2026-08-24) — a silently revoked shared platform token now opens a real Incident instead of going undetected.

**Growth features**: auto-publish new products to Facebook/Instagram (zero ongoing human login), resume-on-refresh for every multi-step flow, real website-content crawling into draft FAQs.

**Billing lifecycle**: subscription cancellation shipped 2026-08-24, admin-only by explicit direction — immediate cutoff (never gated behind a payment), final cycle's usage billed and emailed as an invoice rather than pushed for in real time. Plan changes shipped 2026-08-25 — upgrades are tenant self-service and immediate, downgrades are admin-only and deferred to the next renewal (closes the "downgrade right before the bill" gaming risk, and the "retroactive billing from an un-prorated mid-cycle change" trap — no proration exists anywhere in this billing model). Both items fully resolved — see [`GAP-REGISTER-2026-08-24.md`](GAP-REGISTER-2026-08-24.md) items 3 and 4 for the full design reasoning and live verification.

**Prepaid billing redesign — in progress, 2026-08-25**: post-paid usage (billed at renewal, real risk of unpaid accumulation) replaced with two real prepaid KES balances per tenant (messages, AI understanding), checked *before* the real external cost, never after; Enterprise alone stays post-paid. Message-balance gate and a centralized AI-balance gate (inside the one real `callLLM()` choke point every AI-calling function shares — closes a real gap where three AI-calling functions besides `understand()` were found live-untracked) are both shipped and live-verified, including graceful no-disclosure degradation on exhaustion and a boot-time migration so subscriptions that predate this feature aren't cut off. Low-balance notifications shipped and live-verified — one combined SMS+email notification (never two) per crossing, plus a dashboard bell warning, both live-verified for correct threshold detection, once-per-crossing timing, and clearing after a top-up. **Not yet built**: the top-up flow and the `/onboard` trial-first flow changes. Full detail: [`GAP-REGISTER-2026-08-24.md`](GAP-REGISTER-2026-08-24.md) item 5.

**Full detail and evidence for every item above**: [`ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md`](ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md) (the phase-by-phase build log) and [`OPERATIONS-GUIDE-2026-08-23.md`](OPERATIONS-GUIDE-2026-08-23.md) (security/ops hardening rounds, numbered §1-§65+).

---

## What remains

### Blocked on an external provider or a decision only you can make — not more code

16 items now (items #1 and #5 done, see below), each with exact next steps, every one re-verified against live evidence 2026-08-24: [`EXTERNAL-REGISTRATIONS-CHECKLIST-2026-08-24.md`](EXTERNAL-REGISTRATIONS-CHECKLIST-2026-08-24.md). Fastest to close of what's left: a real Telegram bot token (minutes, self-service) and the Resend Inbound dashboard setup (~15 min, self-service).

✅ **The urgent Access/Tech-Provider warning found during the audit is resolved (pending Meta's review).** WhatsApp Business Verification (item #1) — legal name, address, phone, Tax ID, Primary Page, and domain verification — was fully completed and submitted 2026-08-24, walked through live end-to-end. Meta's own confirmation: "In review... about 2 business days." Once it clears, App Review (#3) and Instagram App Review (#7) become the next real steps.

**WhatsApp access-token health monitoring (item #5) is done** — shipped 2026-08-24, see Operations Guide §66.

### Genuine, unblocked engineering work still open

- **Public Feedback / Quality Centre** — Phase A (support-ticket triage dashboard) and now Phase B's invitation toggle (2026-08-24, admin-controlled, default off) are shipped. The three open design questions blocking Phase B are resolved — see `PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md`'s "Open questions" section. **Still deferred, by the doc's own explicit design**: the `TestExercise`/`TestCase`/`Finding`/`AssuranceReport` schema, PDF reports, and the ROI/evaluation layer — these wait until the pilot (now unblocked to start) has produced real triaged findings; building them against zero real data would be the "manufactured score, empty pipe" trap the doc itself warns against.
- **Phase 5 workflow engine** — 4 flows (`awaiting_otp`, `awaiting_identify`, `awaiting_cv_details`, `awaiting_delivery_feedback`) were deliberately left bespoke rather than migrated to the generic engine; may stay that way permanently.
- **`resolveFieldConflict()`** (Phase 4) — built and tested, zero live callers yet; no tenant has two connectors to the same external system to trigger a real conflict.

### Deliberately unscoped, future-strategic — no work started, and shouldn't be until there's a real need

Mode 2 outbound/proactive messaging (marketing, notifications, follow-ups to known contacts); the Public Social Agent (auto-replying to public posts/comments — "Grok-on-X" style); social-media connectors, OCR/document ingestion beyond PDF, research/plagiarism tooling (Phase 7's unscoped remainder); X/Twitter as a channel (viable but costs money both directions — $0.025/round-trip); Voice/IVR (real and buildable, not started); TikTok (deferred). LinkedIn was evaluated and **rejected** — genuinely incompatible with P2Less's auto-reply model under LinkedIn's own policy.

---

*Last updated: 2026-08-25 (prepaid billing — low-balance notifications: combined SMS+email + dashboard bell). Update this doc (and push it) in the same round as any change that ships, closes an external item, or surfaces a new gap — don't let it go stale.*
