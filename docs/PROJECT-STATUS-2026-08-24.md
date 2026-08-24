# P2Less — Project Status (goal / achieved / remaining)

**This is the one document to read first for "where are we."** Kept current every round and pushed immediately — not a snapshot that goes stale. Full reasoning, evidence, and history live in the linked docs below; this page states the current state in the fewest words that stay honest.

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

**Channels — live today**: WhatsApp (the original channel) and the embeddable website widget. **Built, needs one real-world step to prove the round-trip**: Facebook Messenger (a real Page is connected in production; needs a Meta App Tester invite accepted), Telegram (needs a real `@BotFather` token), Email via Resend Inbound (needs the Resend dashboard configured). **Not started**: Instagram DMs (blocked on Meta App Review), WhatsApp self-service onboarding for other tenants (Phase 9, paused on a spare test number).

**Registration & data model**: `useCases`/`channelsNeeded` capture what an org actually wants at signup (not sector-only); capability-based dashboard navigation shows only what's relevant to what a tenant actually uses.

**Security hardening**: structural tenant isolation (an ORM-level Prisma extension auto-scoping all 27 tenant-scoped models, AsyncLocalStorage-backed — currently warn-only after a real production incident, see the Operations Guide for the full story); SSRF guard shared across every server-side fetch of a tenant-supplied URL, with IP-pinning closing a DNS-rebinding TOCTOU window (2026-08-24); `CREDENTIAL_KEY` rotated from a guessable placeholder to a real random key; five trial-abuse hardening items on `/onboard` (email canonicalization, signup rate-limiting, real phone OTP, admin anomaly alerts, Stripe card-on-file).

**Growth features**: auto-publish new products to Facebook/Instagram (zero ongoing human login), resume-on-refresh for every multi-step flow, real website-content crawling into draft FAQs.

**Full detail and evidence for every item above**: [`ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md`](ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md) (the phase-by-phase build log) and [`OPERATIONS-GUIDE-2026-08-23.md`](OPERATIONS-GUIDE-2026-08-23.md) (security/ops hardening rounds, numbered §1-§65+).

---

## What remains

### Blocked on an external provider or a decision only you can make — not more code

All 18 items, grouped by provider, each with exact next steps: [`EXTERNAL-REGISTRATIONS-CHECKLIST-2026-08-24.md`](EXTERNAL-REGISTRATIONS-CHECKLIST-2026-08-24.md). Fastest to close: a real Telegram bot token (minutes, self-service) and the Resend Inbound dashboard setup (~15 min, self-service). Slowest: Meta Business Verification, Meta App Review, and M-Pesa's Daraja production Go-Live (all real review processes on the provider's own timeline).

### Genuine, unblocked engineering work still open

- **WhatsApp access-token health monitoring** — 🔧 **IN PROGRESS, started 2026-08-24.** The platform's shared WhatsApp Cloud API token has no live validity check today; a silent revocation would go undetected. Being built now (a shared Meta `debug_token` health-check helper, wired into the existing integration-health sweep and a new incident-detection check).
- **Messenger media/postback handling** — today's Messenger slice is text-only; no image/attachment or button-postback handling yet.
- **Public Feedback / Quality Centre** — only Phase A (support-ticket triage dashboard) is shipped. The `TestExercise`/`TestCase`/`Finding`/`AssuranceReport` model, PDF reports, public feedback channels, and the ROI/evaluation layer are still design-only. See `PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md`.
- **Phase 5 workflow engine** — 4 flows (`awaiting_otp`, `awaiting_identify`, `awaiting_cv_details`, `awaiting_delivery_feedback`) were deliberately left bespoke rather than migrated to the generic engine; may stay that way permanently.
- **`resolveFieldConflict()`** (Phase 4) — built and tested, zero live callers yet; no tenant has two connectors to the same external system to trigger a real conflict.

### Deliberately unscoped, future-strategic — no work started, and shouldn't be until there's a real need

Mode 2 outbound/proactive messaging (marketing, notifications, follow-ups to known contacts); the Public Social Agent (auto-replying to public posts/comments — "Grok-on-X" style); social-media connectors, OCR/document ingestion beyond PDF, research/plagiarism tooling (Phase 7's unscoped remainder); X/Twitter as a channel (viable but costs money both directions — $0.025/round-trip); Voice/IVR (real and buildable, not started); TikTok (deferred). LinkedIn was evaluated and **rejected** — genuinely incompatible with P2Less's auto-reply model under LinkedIn's own policy.

---

*Last updated: 2026-08-24. Update this doc (and push it) in the same round as any change that ships, closes an external item, or surfaces a new gap — don't let it go stale.*
