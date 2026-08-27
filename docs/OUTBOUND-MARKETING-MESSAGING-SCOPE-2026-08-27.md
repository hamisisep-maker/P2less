# Scoping: outbound/proactive WhatsApp messaging (marketing, campaigns)

Recorded 2026-08-27. **Documentation only — nothing in this doc has been built.** Written after a direct request to make P2Less able to "do marketing as well" — i.e. let a tenant send a message to contacts who haven't messaged in first, not just reply to inbound. This is a genuinely different capability from anything P2Less does today (referred to elsewhere in the docs as "Mode 2" — see `PROJECT-STATUS-2026-08-24.md`'s "Deliberately unscoped" list). Every finding below is grounded in a direct read of the current codebase, not general advice.

---

## Why this needs real scoping before any code, not a quick add

**P2Less has never sent a message that wasn't a reply.** Every single outbound send today — on both the official Meta transport and the unofficial Baileys transport — happens inside `handleInbound()`, triggered by an inbound message that already exists. There is no code path anywhere that creates a conversation or sends a message to a contact who hasn't just messaged in. Marketing is the opposite of that by definition: reaching someone who *hasn't* messaged recently.

**And the timing risk is real, not theoretical.** This session already watched a WhatsApp number get restricted (`error 463`, a real anti-abuse throttle) from ordinary connect/reconnect testing. Marketing sends to non-opted-in or stale contacts are exactly the behavior WhatsApp's abuse detection is built to catch — building this carelessly risks a genuine, hard-to-reverse ban on a number that's meant to carry real customer traffic.

---

## What exists today to build on

- **`Message.direction`** (`"in" | "out"`) already exists — no schema change needed to distinguish sent-by-us from received.
- **`deliver()`** (`src/lib/transport.ts`) is the one real funnel every channel already goes through, and already knows how to send text/image/document/audio via both transports. A campaign feature should route through this, not duplicate it.
- **The prepaid billing gate** (`prepaid-billing.ts`: `hasMessageBudget()`/`debitMessageBalance()`) is a real, working pattern for "check budget, then debit" — the shape is right, but it's built for exactly one send per inbound event, not a batch of N.
- **The `Notification` model** (queued row → `scheduledFor` → `status` → a dispatch-sweep background job with retry/backoff) is the closest existing analog to "queue something, send it later, track whether it went out." It's built for system-to-admin notifications today, not customer sends, but the *shape* — queue → sweep → retry — is the right pattern to imitate for campaign dispatch.

## What genuinely does not exist and would need building

**1. Consent/opt-in tracking — does not exist at all.** No field anywhere on `Contact` (or elsewhere) records whether a phone number has ever agreed to receive anything. This is the real starting point, not an afterthought: WhatsApp requires demonstrable opt-in before a marketing-category template can legally be sent to someone, and building the send pipeline before the consent model would build the feature backwards. Needs: a real `Contact.marketingOptIn`/`optedInAt`/`optInSource` field (or a small separate consent table if a contact needs multiple channel-specific consents later), and a real place that consent gets captured — e.g. an explicit checkbox during the identify/OTP flow, or a keyword-based opt-in ("reply YES to get updates") — not an assumption that messaging the number once implies consent to marketing.

**2. WhatsApp message templates — does not exist at all, on either transport.** The official Meta transport's `deliver()` only ever builds `type: "text" | "image" | "document" | "audio"` payloads — never `type: "template"`. Meta requires marketing messages sent outside a customer's active 24-hour window to use a **pre-submitted, Meta-approved template** (a fixed structure with named placeholder variables, submitted via the Graph API's own template-management endpoints, reviewed by Meta before it can be used — this review can take hours to days and can be rejected). This is a real, separate integration to build: template creation/submission via the API, a way to check approval status, and a send path that references an approved template by name/language instead of raw text. Baileys has no equivalent concept at all — it's an unofficial personal-device connection, not a Business-tier API, so it structurally cannot send Meta-approved marketing templates. **Practical conclusion: marketing sends should be Meta-official-transport only.** Baileys should stay reply-only.

**3. Conversation creation is inbound-only today.** `conversation.ts` only ever creates a `Contact`/`Conversation` in response to an inbound message. A campaign send to a contact needs a path that creates or reuses a conversation *without* an inbound trigger — a real, if small, change to that flow.

**4. No campaign/broadcast data model exists.** No `Campaign`, `Broadcast`, or recipient-list concept anywhere in the schema. Needed: something to hold "this campaign, this template, this recipient list, this schedule, this tenant" plus a per-recipient send-status row (queued/sent/failed/skipped-no-consent) — closer in shape to `Notification`'s queue-and-sweep pattern than anything else that exists today.

**5. No one-off scheduled dispatch exists.** `job-runner.ts`'s background jobs are all fixed-interval-forever (`setInterval`, run every N minutes) — there's no "run this specific batch at this specific future timestamp" primitive. A campaign scheduled for a future time needs a real due-time queue and a poller that dispatches rows once they're due, not a recurring interval job.

**6. Billing has no marketing-category price or batch-budget check.** Today there's exactly one WhatsApp send price (`price_conversation_kes`, with a Baileys discount as the only variant) and the budget check/debit happens once per inbound event. Meta bills marketing-template sends at their own (typically higher) conversation-category rate, separate from free-form service replies. This needs: a new price setting, a `message_out_marketing` usage type (so campaign volume doesn't get silently folded into regular reply accounting), and a genuinely new **batch** budget check — "do we have enough balance for all N recipients, and what happens if it runs out partway through a send" — since today's gate only ever reasons about one send at a time.

**7. No rate limiting exists on any message-send path today.** `rate-limit.ts` is a real, reusable primitive, but it's currently only used for auth flows (OTP requests, password resets, invites) — never anywhere near `transport.ts` or `conversation.ts`. A campaign sending to hundreds/thousands of contacts needs real throttling, both to respect WhatsApp Business's own per-number messaging-throughput tiers (these scale up with a number's trust rating over time, not on demand) and to protect the number from looking like abuse.

---

## Recommended phasing

**Phase 1 — Consent model.** `Contact` opt-in field(s), a real capture mechanism, and a way for a tenant to see who's actually opted in before anything else gets built. This has to come first — everything downstream depends on knowing who's legally reachable.

**Phase 2 — Meta message template integration.** Template creation/submission via the Graph API, approval-status tracking, and a `deliver()`-adjacent send path that uses an approved template instead of free text. Official Meta transport only — Baileys excluded structurally, not by choice.

**Phase 3 — Campaign data model + one-off scheduled dispatch.** The `Campaign`/recipient-list schema, plus the due-time queue-and-sweep dispatcher (modeled on `Notification`'s pattern, not `job-runner.ts`'s fixed-interval one).

**Phase 4 — Batch billing + rate limiting.** New marketing price setting and usage type, a real batch pre-flight budget check, and real throttling on the send loop.

**Phase 5 — UI.** A tenant-facing "create a campaign" flow — recipient selection (opted-in contacts only, enforced server-side not just in the UI), template picker, schedule, and a send-status view. Deliberately last: nothing here is worth a UI until Phases 1–4 make it safe and real underneath.

---

## What this is not, and shouldn't try to be

Not a general "send anything to anyone anytime" system — the consent and template-approval requirements are real, external, Meta-enforced constraints, not P2Less choices, and skipping them doesn't just risk policy violations, it risks the number itself getting banned (as today's session already demonstrated is a real, live consequence). Not a Baileys feature. Not something to build ahead of Phase 1's consent model, no matter how tempting it is to start with the send pipeline instead.

## Bottom line

This is a real, multi-phase feature — consent tracking, a genuine Meta template-approval integration, a new campaign data model, batch-aware billing, and real send throttling, in that order. None of it reuses existing "reply to an inbound message" code as-is; it's adjacent, parallel infrastructure that has to be built carefully specifically because the number that would carry it is the same number real customers depend on for support. Given zero real paying clients exist yet (per [[project-p2less-gtm-strategy]]) and the connected test number is currently under a live WhatsApp restriction from ordinary testing, the honest recommendation is: build this once there's a real client who has actually asked for it, not ahead of that need — and build Phase 1 (consent) first regardless of when that is.
