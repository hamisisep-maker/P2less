# Future infrastructure migration + brand naming — considerations, not started

Recorded 2026-08-22, per the user's request to document both for later, before either is acted on.

---

## Infrastructure migration (future, pending purchases)

**Plan, as stated by the user**: migrate the whole system — GitHub repository, hosting, and domain — to new infrastructure once purchased:
- A new GitHub organization/repo (moving off the current `hamisisep-maker/P2less` repo).
- A new server/hosting (moving off Railway, or a new Railway project — unspecified).
- A new domain (moving off `p2less-app-production.up.railway.app`).

**Not started. Nothing purchased yet.** No code changes, no infra changes needed until the user has actually bought the new domain/hosting. Flagging real considerations for when that happens, so the migration doesn't lose anything already built:

- **Environment variables and secrets** (`WHATSAPP_APP_SECRET`, `STRIPE_SECRET_KEY`, AI provider keys, `WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI`, `MESSENGER_OAUTH_REDIRECT_URI`, etc.) all need to be re-set on the new host — none of this is stored in the repo (`.env` is gitignored), so a repo migration alone won't carry them.
- **Meta App redirect URIs are tied to the current domain** — both the WhatsApp Embedded Signup config and the Messenger OAuth "Valid OAuth Redirect URIs" list reference `https://p2less-app-production.up.railway.app/...` explicitly. A domain change means updating both on Meta's side (Facebook Login for Business settings) BEFORE cutting over, or WhatsApp/Messenger connection flows will break for any new signup during the transition.
- **The SQLite database** (`prisma/schema.prisma`'s current provider) — confirm whether the new server continues on SQLite or moves to a hosted Postgres/MySQL; if the latter, this needs a real migration plan (schema + data), not just a redeploy. **A full scope for this now exists**: [`SCALING-MIGRATION-SCOPE-2026-08-27.md`](SCALING-MIGRATION-SCOPE-2026-08-27.md) — written in response to a real question about handling 10,000 messages/minute, it found the SQLite swap alone isn't enough: three specific code paths (the audit-log hash chain, training-session participant cap, ticket/invoice numbering) are only correct today because SQLite serializes writers, and would need real row-locking fixes before Postgres + multiple instances.
- **A real cutover checklist belongs here once dates are known** — DNS TTL lowering ahead of the switch, a maintenance-mode window (the platform already has one — `getSetting("maintenance_enabled")`, used today for whole-platform maintenance in `dashboard/layout.tsx`), and a rollback plan if the new host has an issue.
- **GitHub repo migration** is comparatively low-risk (git history transfers cleanly via a standard remote move/mirror push) — the real risk is in the secrets and Meta-side config above, not the code itself.

**Revisit this section once the domain/hosting is actually purchased** — turn the bullets above into a real dated checklist at that point.

---

## Brand naming — P2Less → E2Less, under consideration

**The idea, as the user described it**: keep "P2Less" as a name reserved for a future, more literally paperwork-focused product ("paper to less paper"). Rename the current, broader conversational-automation platform to **E2Less** ("effort to less effort") — a more accurate description of what it actually does today (WhatsApp/Messenger-driven automation across schools, hospitals, retail, SACCOs, NGOs, government — not really a "paper reduction" tool specifically anymore).

**Assessment, given directly when asked**:

- **The brand-family logic is sound.** Reserving "P2Less" for a genuinely paper-specific future product while renaming the current broader platform is a deliberate, coherent positioning move, not just a cosmetic change. "Effort to less effort" is honestly a *more* accurate description of the current product than "paper to less paper" — most of what P2Less does today (conversational AI, connector integrations, multi-channel messaging) isn't about paper at all.
- **Real risk to flag**: "P2" reads instantly as "paper" once you know the product (and even then, the numeronym pattern P2P/B2B/B2C helps it click). "E2" doesn't cue "effort" nearly as fast — could just as easily be misread as "email-to-less," "enterprise-to-less," or land as unclear on first encounter. Worth testing the bare name on a couple of people with zero context, purely to see what they guess it means before committing.
- **Two real checks needed before committing, neither done here** (need a live registrar/trademark search, not a general web search):
  1. Domain availability — `e2less.com`, `.io`, `.co.ke` (or whichever TLDs matter for the target market).
  2. Basic name-collision check — "E2" is common enough as a prefix (e.g. E2E testing tools) that a quick search for existing "E2Less"/similar brands is worth doing.
- **Timing is genuinely good, if this is happening at all.** Per [[p2less-platform-vision]]/[[project-p2less-gtm-strategy]], P2Less has zero real paying clients as of this date — meaning a rename right now costs nothing (no client re-briefing, no broken bookmarks/links, no lost case-study SEO). Waiting until after landing real clients would make the exact same rename meaningfully more expensive. If the rename is happening, doing it before the GTM push (not after) is the right sequencing.

**Not started — no code, docs, or branding assets have been renamed.** This section exists purely to record the decision context so it isn't lost, per the user's own stated documentation discipline (see [[feedback-p2less-tracking-discipline]]).

**Revisit when**: the user has checked domain/trademark availability and decided whether to proceed — update this doc with the outcome either way (including "decided not to rename, keeping P2Less" if that's the call, so the reasoning isn't lost either).
