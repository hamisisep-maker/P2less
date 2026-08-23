# P2Less Operations & Quality Centre — System Operating Guide

Companion to `docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md` (the *why it's designed this way* document) and `docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md` (the *what's shipped* record). This document is the *how do I actually operate it* one — proposed by the user 2026-08-23 as the missing layer: an operating manual, not another architecture doc.

**Discipline carried over from the other two docs, non-negotiable here too**: every step below is marked either **✅ real, works today** (verified against the actual code and, where marked, live-tested) or **🔮 vision, not built** (the user's original proposal included several capabilities — an interactive "report a problem" button, a 10-stage ticket status flow, a full system-trace view — that don't exist yet). Teaching an admin a workflow that doesn't actually exist is exactly the kind of overclaim principle 6 exists to prevent. Where the real system is coarser than the ideal, this guide says so and shows how to work with what's actually there.

## 1. Purpose

How P2Less is operated while real users are actively using it. Not a feature list — the operational flow:

> User action → system event → ticket → admin review → investigation → resolution → verification → regression test → (eventually) evidence/reporting.

## 2. Core operating principle

An admin should never have to manually reconstruct what happened from scratch. **✅ Real today, partially**: a ticket carries `tenantId`/`contactId`/`conversationId`, and the reviewer can now pin it to the exact `Message` it's about (Phase A, shipped 2026-08-23). **🔮 Not yet**: the ticket view doesn't show the deeper trace — which intent matched, which connector ran, what it returned, which AI provider answered. Today a reviewer gets there by opening the linked message/conversation and, if needed, checking `AiRequestLog` directly (no UI for this yet) — not the one-screen trace the user's original proposal describes. Worth building once Phase A proves the workflow is used enough to justify it.

## 2a. Three systems, connected — not one giant model

Confirmed as an accurate description of the real architecture (user's framing, 2026-08-23), worth stating explicitly since it's the cleanest way to explain the whole thing to a new admin:

```
                 P2LESS PLATFORM
                       │
       ┌───────────────┼────────────────┐
       ↓               ↓                ↓
    RUNTIME        OPERATIONS        ASSURANCE
       │               │                │
       └───────────────┼────────────────┘
                       ↓
                Shared evidence
                + audit trail
                + identifiers
```

- **Runtime** — the thing serving users. `handleInbound()` → intent → authorization → connector → response. ✅ Real, this is `conversation.ts`.
- **Operations** — the thing keeping P2Less running. `SupportTicket` → `TicketEvent` → assignment → resolution → `Incident`. ✅ Real, Phase A.
- **Assurance** — the thing proving and improving quality. Quality classification → action decision → regression test → (eventually) evaluation → evidence → reports. 🔶 Partially real — classification and the action decision are shipped; evaluation/evidence/reports are still vision (design doc's Evidence & Assurance section).

They connect through shared identifiers (`tenantId`, `conversationId`, `ticket.relatedMessageId`) and the existing audit trail — **not** a new universal event table. This is the same "don't build a parallel system" discipline the design doc already states for `TicketEvent` vs. a hypothetical `QualityEvent`, just named at the platform level now instead of just the ticket level.

## 3. Chat is evidence — it is not the assurance layer

**✅ Real, adopted as a formal principle** (see the six governing principles in the design doc). A `SupportTicket` created by an escalation is a raw report. Nothing changes AI behavior until a human reviews it, classifies it, and someone deliberately ships a fix. Illustrated with the same loan-balance example already in the design doc — kept there rather than duplicated here.

## 4. Two sources of quality evidence

- **Real-world feedback** — ✅ real today: WhatsApp/widget escalations, or an admin manually logging a report via `NewTicketModal`.
- **Planned testing** (`TestExercise`/`TestCase`) — 🔮 not built. See the design doc's Evidence & Assurance section for why this is deliberately deferred until there's real finding volume to seed it with.

Both are meant to converge on the same `SupportTicket` → classify → fix → regression-test pipeline once `TestExercise` exists. Today, only the feedback path is real.

## 5. How a user actually reports a problem today

**✅ Real, live-verified 2026-08-23 on both WhatsApp and the widget.** There is no interactive "[Report a problem]" button — the mechanism is a plain phrase match:

```
User: I want to talk to a human
   ↓ (matches /(speak|talk).*(human|someone|agent|person)|human agent|customer care/)
P2Less: I've created a support request and notified the team.
        Someone will get back to you shortly.
```

This fires from `escalateToHuman()` in `conversation.ts`, regardless of whether it's the user's first message or their fiftieth (fixed 2026-08-23 — it used to only work for already-recognized contacts; see the roadmap doc's escalation-routing fix entry). It creates a real `SupportTicket` (`source: "tenant"`), a `created` `TicketEvent`, and queues an admin notification.

**🔮 Gap found writing this guide, worth fixing**: the reply doesn't tell the user their ticket number. The user's own proposal explicitly calls this out ("the user should receive a ticket reference, e.g. P2L-1042") and it's a real, small, valuable gap — see the fix below.

**🔮 Not real yet**: no interactive report flow ("would you like to report this issue?" / a structured "what did you expect instead?" follow-up question), no attachment prompt in the escalation reply itself (attachments exist as a mechanism — `addTicketAttachmentAction`, 5MB cap, image/PDF — but only via the admin dashboard, not offered to the user mid-conversation).

## 6. When same-channel reporting isn't available

**✅ Real, already-established discipline**: `currentChannelSupportsFiles()` gates whether the AI offers to receive a screenshot — only true on WhatsApp today. A channel is never advertised as supporting something until its full journey is tested (principle 6). No channel-specific "nearest supported path" message exists yet for reporting itself — today every channel gets the identical escalation reply.

## 7. What happens when a ticket is created

**✅ Real**: `created` → (admin assigns) `assigned` → (admin works it) `in_progress` → ... → `resolved`/`closed`, with every transition recorded as a `TicketEvent` (see `src/lib/ticket-actions.ts`). **🔮 Not real**: no automatic "acknowledgement → queue" distinct stage — a ticket is just `open` until an admin picks it up.

## 8. What the admin should do after a ticket is created

**✅ Real, today's actual checklist** — open `/admin/tickets/[id]` and review, in order:

1. Subject, description, tenant, contact (header + `PageHeader` subtitle)
2. Source badge (`internal` / `tenant` / `public_report`) — who/what originated it
3. Related payment / related incident (if linked)
4. **Quality investigation panel** — set the category (11-option taxonomy, see §10) and pick the specific message this is about from a dropdown of the last 30 messages in that conversation
5. Timeline — every event so far, chronological, internal notes and customer-visible responses interleaved

**🔮 Not yet on this screen**: intent match, connector call/response, AI provider/model, authorization result. For now, get there by reading the linked message and (if truly needed) checking `AiRequestLog` directly — there's no admin UI for that log yet.

**The actual discipline, unchanged from the user's proposal**: investigate with what the system already has before asking the user to repeat themselves.

## 9. When should an admin contact the user?

**✅ Real, no tooling change needed — this is a judgment call, not a feature.** Contact the user when the evidence is genuinely incomplete (can't tell what they expected, can't reproduce from the linked message alone), not as the default first move. `addCustomerResponseAction` delivers a reply over the same channel (real WhatsApp send, not just a DB row) if you do need to.

## 10. Ticket classification — the real taxonomy

**✅ Real, exactly 11 values, enforced in code** (`src/lib/quality-taxonomy.ts`, shared between the DB, the triage UI, and the design doc so they can't drift):

`bug` · `ai_hallucination` · `knowledge_gap` · `incorrect_source_data` · `incorrect_connector_result` · `intent_classification_error` · `authorization_error` · `integration_failure` · `conversation_context_failure` · `correct_user_misunderstanding` · `unknown_investigating`

Note for anyone comparing against the original proposal: there is no separate "AI Transformation / Response Integrity Failure" category — that exact case (the loan-balance example below) is deliberately filed under `ai_hallucination`, per the design doc's own note that the category is "reserved specifically for cases like [the response-integrity example], not a catch-all." Don't add a 12th category without updating `quality-taxonomy.ts` and the design doc together.

## 11–13. Worked examples

Kept identical to the design doc's own worked examples (§ "The investigation waterfall") rather than duplicated here — same loan-balance 3-way diagram (connector-correct/AI-correct vs. connector-wrong vs. AI-transformed-a-correct-value), same context-failure precedent (round 9's real memory bug). Classify using the 11 real values above, not a redrawn taxonomy.

## 14. Corrective action — and the Action Decision that makes it explicit

**✅ Real principle, already adopted** (principle 6 / the correction-routing ladder in the design doc's evaluation-layer section): configuration/knowledge → application code → provider/model choice → fine-tuning, in that order, cheapest-safe-layer first. Every fix shipped this entire project has been a prompt instruction, an FAQ, or code — never a retrain.

**✅ Real, shipped 2026-08-23** — this is no longer just a principle a reviewer is trusted to remember; it's a mandatory, separate step in the ticket workspace. Once a ticket has a `qualityCategory` (root cause), the Quality investigation panel gates open a second decision: **`actionRequired`**, one of 12 values (`no_action | knowledge_update | configuration_change | prompt_change | connector_data_fix | ai_model_change | operational_procedure | user_training | monitoring_change | documentation_change | ux_change | code_change`), with a mandatory `actionReason` — the server rejects the decision without one. This exists specifically so `qualityCategory` (what went wrong) never gets treated as automatically implying `code_change` (what to do about it) — a `knowledge_gap` finding might just need an FAQ edit; `ai_hallucination` might be a prompt fix, not code.

The `/admin/quality` dashboard now shows a live "Actions" breakdown — real counts per decision, plus a computed `X% of decided findings required a code change`, answering the actual management question this was built for: **how many of the problems we're finding actually require developers?** Same discipline as every other number on this dashboard: computed from real `actionRequired` values on real tickets, never typed in. With only one ticket decided so far (Phase A pilot, pre-recruiting), that percentage is currently a real but tiny sample — treat it as a working mechanism proven correct, not yet a meaningful trend.

## 15–17. The AI improvement loop / never auto-learn from a report / improve without going offline

**✅ Real, already the case.** Nothing in `escalateToHuman()` or anywhere else auto-modifies a prompt, FAQ, or connector from a user's words. Every fix this session shipped (the escalation-routing fix, the bot-honesty prompt fix, all five UX phases) went through: reproduce → fix → typecheck → regression suite → deploy → re-verify live — while the app stayed up throughout. That loop **is** the operating model already, not a future aspiration.

## 18. Quality Centre dashboard — what's actually on it today

**✅ Real** (`/admin/quality`, shipped 2026-08-23): a "Recruit pilot testers" card (ready-to-copy message), an "Origin, this pilot" count by source (internal/tenant/public), an "Actions" breakdown (live counts per action decision + the computed "% required code" — see §14), and the 11 categories each listing their tickets with a live status/source/action badge, empty ones shown honestly as "Nothing in this category yet" rather than hidden.

**🔮 Not real** — everything in the user's proposed Overview list requires data that doesn't exist yet and must not be faked: "Verified Findings," "Critical Issues," "Regression Failures," "Recent Test Exercises," "Current Evaluation," "Baseline vs Current." These all require `Finding`/`TestExercise` (deferred — see design doc §"Sequencing"). The one rule that already governs both docs applies here identically: **no manually-typed number ever appears on this dashboard.** Every number shown today (`Internal 1 / Tenant 0 / Public 0`, category counts) is a live query result. When the aspirational metrics get built, they must clear the same bar.

## 19. Ticket detail view — real vs. proposed

**✅ Real sections**: status/priority/category/source/quality badges, related payment/incident, quality-investigation panel + message picker, attachments, interleaved timeline, internal-note/customer-response composer.

**🔮 Proposed, not built**: a dedicated "System Trace" panel (message → intent → authorization → resource → connector → AI request → response, one screen). Right now that trace is reconstructed by hand from the linked message plus (if needed) direct DB/log access — a real gap, not a documentation gap, worth prioritizing once Phase A shows real usage volume.

## 20. Don't duplicate the system timeline

**✅ Real, already the architecture.** `TicketEvent` is the one timeline; nothing this session built introduced a parallel event table. `Document` is reused for attachments (not a new file store), same reuse discipline documented in the design doc's "Don't build a parallel system" section.

## 21. Ticket status — real values, not the proposed 10-stage flow

**✅ Real** (`SupportTicket.status`, enforced by `VALID_STATUSES` in `ticket-actions.ts`): `open → assigned → in_progress → waiting_on_customer → resolved/closed`, plus `reopened`. Seven states, not ten. A rough mapping from the richer conceptual flow the user proposed, for training purposes — **not a schema change, just how to think about the real states**:

| Conceptual stage | Real status today |
|---|---|
| NEW / ACKNOWLEDGED | `open` |
| INVESTIGATING / CLASSIFIED | `in_progress` (once assigned + `qualityCategory` set) |
| ACTION_REQUIRED / FIX_IN_PROGRESS | still `in_progress` — tracked via internal notes, not a distinct status |
| AWAITING_VERIFICATION | no real equivalent — `waiting_on_customer` means waiting on the *customer*, not waiting to verify a fix. Use an internal note. |
| VERIFIED / RESOLVED | `resolved` (`resolution`/`resolutionReason` — free text, not an enum) |
| CLOSED | `closed` |
| NOT_A_BUG / DUPLICATE / USER_ERROR / CANNOT_REPRODUCE / WONT_FIX | captured in `resolutionReason`'s free text today, not a structured value |

Worth a real schema decision later (a `resolutionReason` enum) if these distinctions turn out to matter for reporting — not scoped now.

## 22. Admin responsibilities

**✅ Real, matches existing permission bundles** (`admin-permissions.ts`): `tickets.view` / `tickets.manage` / `tickets.internal_notes` / `tickets.resolve` map roughly to the Support/Operations/AI-Engineering/Security split the user proposed, though today Quality Centre access reuses plain `tickets.view`/`tickets.manage` rather than a dedicated quality-role permission (documented Phase A decision — revisit if the pilot outgrows it).

## 23. Internal / Client / Executive views

**🔮 Vision only** — this is the Evidence & Assurance subsystem's presentation-tier design (design doc §"Presentation tiers"), explicitly not built. Today there is only one view: internal admin.

## 24–25. Evaluation measurement / multimodal quality

**🔮 Vision only**, sequenced after `TestExercise`/`Finding` hold real data — see the design doc's "Evaluation & ROI layer" and "Multimodal evaluation" sections, not repeated here.

## 26. Regression testing

**✅ Real, already the discipline** — `scripts/test.ts`, 73 real HTTP-driven E2E cases, run after every fix this entire project. Not yet wired to auto-generate a new case from a verified `Finding` (that's what `TestCase` would formalize) — today it's manual, but consistently applied.

## 27. Testing exercises

**🔮 Vision only** — `TestExercise` doesn't exist. The design doc already names the source of the first real seed data once it's built: this session's own 11 widget bug-hunt rounds, backfilled as historical records.

## 28. What a complete incident actually looks like today

The user's 17-step version, corrected against real mechanics:

```
1.  User asks something P2Less gets wrong
2.  P2Less answers incorrectly
3.  User types "I want to talk to a human" (or similar) — same channel
4.  escalateToHuman() creates a real SupportTicket (source: tenant)
5.  User gets an honest reply — 🔮 doesn't yet include the ticket number
6.  Admin opens /admin/tickets/[id]
7.  Admin reads the linked message + conversation (no auto system-trace yet)
8.  Admin sets qualityCategory via the Quality investigation panel
9.  Finding is now visible on /admin/quality, grouped by category
10. Engineer fixes the correct layer (config/code/prompt — never a blind retrain)
11. npx tsc --noEmit clean
12. Full regression suite run — must be clean or the one known flake, confirmed by reading the actual assertion
13. git commit + push + railway up
14. Live-verified against production directly (not assumed from a green CI light)
15. Admin sends a customer-visible response if warranted (addCustomerResponseAction)
16. Admin marks the ticket resolved (resolution + resolutionReason, both required)
17. Evidence (the ticket, its events, the regression test) stays in the system
```

Steps 10–14 are exactly the loop this session has run for every fix shipped today (the escalation-routing fix and the bot-honesty fix both went through this precisely).

## 29. What the admin should not do

**✅ Real, unchanged from the user's list** — worth keeping verbatim: don't rewrite the user's report, don't blame the AI immediately, don't auto-change AI behavior from one complaint, don't re-ask for information already on the ticket, don't mark something fixed without a regression pass, don't claim a channel/capability works because the code exists rather than because the full journey was tested, don't type a dashboard number by hand, don't delete evidence after resolving, don't conflate a platform `Incident` with a tenant `SupportTicket`.

## 30. Training sequence for a new admin

**✅ Real, directly usable today** — the SEE → UNDERSTAND → TRACE → CLASSIFY → ACT → VERIFY → COMMUNICATE → CLOSE loop from the original proposal maps cleanly onto the real screens:

- **SEE** — the ticket's subject/description/timeline
- **UNDERSTAND** — the linked message + conversation
- **TRACE** — today, manual (read the message; no one-screen trace yet)
- **CLASSIFY** — the Quality investigation panel's category select
- **ACT** — the actual code/config/prompt fix, off-dashboard
- **VERIFY** — typecheck + regression suite + live re-check against production
- **COMMUNICATE** — `addCustomerResponseAction`, or an internal note if no customer contact exists
- **CLOSE** — `resolveTicketAction` (resolution + reason both required)

## 31. Long-term Evidence & Assurance

**🔮 Vision only** — see the design doc in full. Not repeated here.

## 32. Recommended immediate fix, found while writing this guide

Section 5 above flags a real, small, valuable gap: the escalation reply never tells the user their ticket number, even though `ticket.number` (e.g. `"TCK-7"`) is generated and available at the exact point the reply is constructed. Fixing this is in scope for "make everything work" and is tracked as a follow-up in this session — see the roadmap doc for whether it's shipped yet.
