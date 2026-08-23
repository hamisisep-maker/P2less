# P2Less Operations & Quality Centre — System Operating Guide

Companion to `docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-2026-08-23.md` (the *why it's designed this way* document) and `docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md` (the *what's shipped* record). This document is the *how do I actually operate it* one — proposed by the user 2026-08-23 as the missing layer: an operating manual, not another architecture doc.

**Discipline carried over from the other two docs, non-negotiable here too**: every step below is marked either **✅ real, works today** (verified against the actual code and, where marked, live-tested) or **🔮 vision, not built** (the user's original proposal included several capabilities — an interactive "report a problem" button, a 10-stage ticket status flow, a full system-trace view — that don't exist yet). Teaching an admin a workflow that doesn't actually exist is exactly the kind of overclaim principle 6 exists to prevent. Where the real system is coarser than the ideal, this guide says so and shows how to work with what's actually there.

**Status legend, refined 2026-08-23** — the ✅/🔮 shorthand above collapses five real distinctions into two; adopted going forward (new sections below use it; existing ✅/🔮 markers stay valid but coarser, refined opportunistically rather than in one retroactive pass):
- **REAL — verified**: implemented and actually live-tested (browser/API), not just read in the source.
- **REAL — needs verification**: implemented, confirmed by reading the code, not yet exercised live.
- **PARTIAL**: part of the journey works, part doesn't — say exactly which part.
- **VISION**: designed/agreed as direction, nothing built.
- **DEFERRED**: could be built now, deliberately not yet (distinct from VISION — the blocker is a staging decision, not missing infrastructure).

**One more standing rule, stated explicitly 2026-08-23 because it's easy to violate by accident**: document what actually protects the system, never a hypothetical control as if it were the real mechanism. Concrete example already true in this codebase: secrets/API keys are never disclosable by the AI not because of a prompt rule telling it not to, but structurally — they're never included in its context at all. Document that as the real, current protection. A future defense-in-depth control (an explicit rule, a filter) gets documented separately, when and if it's actually added — never merged into the same sentence as if it were already there.

## 1. Purpose

How P2Less is operated while real users are actively using it. Not a feature list — the operational flow:

> User action → system event → ticket → admin review → investigation → resolution → verification → regression test → (eventually) evidence/reporting.

## 2. Core operating principle

An admin should never have to manually reconstruct what happened from scratch. **✅ Real today**: a ticket carries `tenantId`/`contactId`/`conversationId`, the reviewer can pin it to the exact `Message` it's about (Phase A, shipped 2026-08-23), and — **shipped the same day, correcting the "not yet" this section originally said** — the ticket workspace now has a real **System Trace panel** showing exactly what the platform did while handling that message: every `AuditLog` row (connector calls with latency/status, authorization checks, OTP events) and `AiRequestLog` row (provider/model/cost/tokens) sharing that message's `requestId`. Not a mockup — built entirely from data that already existed (`AuditLog`/`AiRequestLog` were already correlated by `requestId`); the only new piece was adding `requestId` to `Message` itself so a specific message could be joined back to its own trace. Live-verified against a real leave-balance query: the panel correctly showed `connector.execute → GET_MY_LEAVE_BALANCE, 2263ms, status 200`. Only gap left: messages created before 2026-08-23 have no `requestId` and honestly show "no trace available" rather than a fabricated one.

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

**✅ Real sections**: status/priority/category/source/quality badges, related payment/incident, quality-investigation panel + message picker, **System Trace panel** (shipped 2026-08-23 — see §2 above), attachments, interleaved timeline, internal-note/customer-response composer.

**🔮 Still not built**: the trace doesn't show intent-match or authorization-check rows yet for every path (only what a given request actually wrote to `AuditLog` — e.g. `authz.deny` shows up when it happens, but there's no explicit "intent matched: X" row today since intent-matching itself isn't audited as its own event). Expanding what `handleInbound()` writes to `AuditLog` would make the trace richer without changing the panel itself.

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
- **TRACE** — the System Trace panel on the ticket (real, shipped 2026-08-23; honestly empty for messages older than that)
- **CLASSIFY** — the Quality investigation panel's category select
- **ACT** — the actual code/config/prompt fix, off-dashboard
- **VERIFY** — typecheck + regression suite + live re-check against production
- **COMMUNICATE** — `addCustomerResponseAction`, or an internal note if no customer contact exists
- **CLOSE** — `resolveTicketAction` (resolution + reason both required)

## 31. Long-term Evidence & Assurance

**🔮 Vision only** — see the design doc in full. Not repeated here.

## 32. Recommended immediate fix, found while writing this guide

**✅ Fixed, shipped 2026-08-23.** The gap this section originally flagged — the escalation reply never told the user their ticket number — is fixed. `escalateToHuman()`'s reply now reads "...Your reference is TCK-7. Someone will get back to you shortly," live-verified on production.

## 33. Visualization — four levels, not "lots of charts"

Proposed by the user 2026-08-23. The organizing rule, worth keeping verbatim as it governs everything below: **every visualization must answer an operational question and be traceable to underlying system records — never built merely because the dashboard has empty space.** Same discipline as every number on `/admin/quality` already.

Four levels, each a different audience and question:

- 🟢 **Level 1 — Operations**: "Is the system healthy right now?" (system health, channels, traffic, failures, incidents, queues)
- 🔵 **Level 2 — Quality Centre**: "What's going wrong?" (feedback, findings, root causes, action types, recurring issues, resolution pipeline)
- 🟣 **Level 3 — AI Evaluation**: "Is the AI actually improving?" (baseline, current, evaluation dimensions, regression, modality performance, cost vs. quality)
- 🟠 **Level 4 — Assurance**: "Can we prove it's been tested and improved?" (testing history, pilot results, verified findings, before/after, evidence, reports)

**Where each real proposal item actually stands:**

- **✅ Real, shipped 2026-08-23 — the single-message System Trace** (Level 1/2 boundary). The highest-leverage item in the original proposal, and the one worth having prioritized: turns the whole system into a readable story for one message — user → channel → message → (audit trail of what happened) → outcome. Built entirely from `AuditLog`/`AiRequestLog`, both already correlated by `requestId`; the only new piece was `Message.requestId` itself. See §2/§19 above.
- **✅ Real, just not charted — category and action breakdowns** (Level 2). `/admin/quality`'s "Origin" and "Actions" cards already show exactly this composition, as live counts/badges rather than bar charts. Recharts is already a dependency in this codebase (loads on every admin page) — charting isn't new infrastructure if a visual treatment is wanted later. Not converted to charts yet because there are only 1–2 real classified tickets right now; a bar chart at that sample size would be more misleading than helpful. Revisit once the pilot produces real volume.
- **🔮 Vision, needs the Evaluation layer** (Level 3, all of it): improvement-over-time, evaluation-dimension percentages, the AI-pipeline stage-success view (`Understanding 98.2%` etc.). None of this can be built honestly until the evaluation methodology itself exists and is validated — see the design doc's "Evaluation & ROI layer," still not started.
- **🔮 Vision, needs new instrumentation that doesn't exist today** (Level 1, most of it): a computed "system health" score, per-channel success-rate definitions, a full report→review→verified→action→fixed→regression→production funnel (today's real funnel is the much smaller `classified → action-decided → resolved`, fully computable now — a smaller honest version worth building before the elaborate one).
- **🔮 Vision, the whole of Level 4**: the Assurance Dashboard / tiered client-government presentation — see the design doc's "Presentation tiers," explicitly gated behind `Finding`/`TestExercise` holding real data.

The guiding rule bears repeating because it's the difference between this section and a generic BI-dashboard wishlist: a chart is only added once there's a real, traceable, non-trivial answer for it to show.

## 34. Messages, channels, and reports — what's real today

Proposed by the user 2026-08-23: does every message know its channel, is there a unified Messages view, and is there a Reports Centre?

**A real, concrete correction found while checking**: the schema *looks* like it tracks channel on `Conversation` (`channelId` → `Channel.type`), but **0 of 177 real conversations in the database have `channelId` set** — that relation is defined but never actually wired into conversation creation. The real, reliable source of truth is **`Contact.channelType`** (set correctly at contact-creation time; a `Contact` is unique per `tenantId + channelType`, so every message in a conversation shares one channel via its contact). So: **✅ every message's channel is genuinely knowable today**, just via a different join than the schema's own field names suggest — `Message → Conversation → Contact.channelType`, not `Conversation.channelId`.

**✅ Shipped 2026-08-23, small and cheap**: the ticket workspace now shows a channel badge (e.g. "Widget," "WhatsApp") next to the other ticket badges, computed from exactly that join. Live-verified — correctly showed "Widget" for a ticket whose linked conversation turned out to be on the widget, not WhatsApp, even though the same contact also has a separate WhatsApp identity (accurate, not an assumption).

**🔮 Not built at all — genuinely new work, not a small gap**:
- A unified `/admin/messages` view (search/filter across every channel, one operational inbox) — doesn't exist. Every message today is only viewable one conversation at a time.
- A Reports Centre (`Operational` / `Quality` / `AI` / `Assurance` report sections) — doesn't exist in any form.
- Channel-level reports ("WhatsApp had 7 quality findings in August," "channel → quality" breakdowns) — computable in principle (the join exists), but not built, and would report on almost nothing at current volume (177 conversations total, 1–2 real quality tickets).

Same staging as everything else in this document: real data foundation confirmed and one cheap, high-signal piece shipped (the channel badge); the bigger Messages/Reports build waits for real pilot volume, same principle-6 discipline as the rest of Evidence & Assurance.

## 35. Ownership and communication flow

Proposed by the user 2026-08-23: every report needs a clear chain of who reported it, who owns it, who's investigating, who verified it, and who told the customer.

**Already real, more of this than it might look like:**
- Internal vs. customer-visible communication (proposal's point 4) — already exactly this. `addInternalNoteAction` and `addCustomerResponseAction` write to the same `TicketEvent` stream but with different `visibility`, and a customer response genuinely delivers over the real channel (WhatsApp `deliver()`), not just a DB row.
- Single-assignee ownership with notification — `assignTicketAction` sets `assignedAdminId` and sends `ticket_assigned` straight to that admin's email, not the general team pool.
- The full activity timeline (proposal's point 9 mockup) — `TicketEvent` already records every action chronologically with an actor (`created`, `assigned`, `quality_classified`, `linked_message`, `action_decided`, `internal_note`, `customer_response`, `resolved`, `reopened`). The data for "who did what when" already exists; it isn't yet rendered in the explicit "X → Y, via which channel" directional format proposed — a presentational improvement worth doing later, not a backend gap.
- Two origins converging on one record (point 6) — the `source` field + the Testing-vs-Feedback split in the design doc already cover this, ahead of `TestExercise` existing.

**✅ Real gap, fixed 2026-08-23** — point 8's "every owner must have an actionable queue" wasn't true: `/admin/tickets` showed every open ticket flat, with no way to see "what's assigned to me." Added a **"My queue"** section (tickets where `assignedAdminId` = the current admin) and an **"Unassigned"** section, both above the full list. Live-verified: correctly empty when nothing's assigned to you, correctly populates on assignment.

**🔮 Genuinely vision, needs concepts that don't exist yet:**
- Category-based auto-routing to a team/owner ("AI issue → Engineering," "connector issue → integration owner") — assignment today is manual, any-admin-to-any-admin, no concept of teams or routing rules.
- Severity-based incident escalation with notification fan-out (critical finding → auto-`Incident` → notify Operations/Security/Management) — `relatedIncidentId` linking exists, but nothing creates that link or decides who to notify automatically.
- A distinct "engineering task" object with its own notify-on-fix/notify-on-verify chain, separate from the ticket itself — deliberately not built when `actionRequired`/`actionReason` shipped (documented then as a heavier, unproven addition to defer).

None of these are worth building ahead of real ticket volume — with 4 real tickets total today, a routing-rules engine would have nothing to route.

**One precise design constraint for whenever routing does get built, worth preserving now so it isn't reinvented later**: assignment (who owns this ticket) and routing (which team a finding's action decision sends it to) are different mechanisms — "My Queue" is the former, real today; a rules engine would be the latter, not yet justified. When it is built, it must route from the **verified finding**, never the raw complaint text — concretely, from `ticket.actionRequired` (set only after investigation) rather than from `ticket.subject`/`description` (the user's original words). This isn't a future retrofit: because `actionRequired` already can't be set until `qualityCategory` is, the system is already structurally shaped to route from a verified conclusion rather than an allegation — routing just needs to key off a field that already exists and already means the right thing.

## 36. Engineering Confidence — a real quality bar, tested against this actual session

Proposed by the user 2026-08-23, reframed from a narrower question ("would a developer like the UI?") into a sharper one worth keeping verbatim:

> Can an experienced engineer investigate P2Less and understand how it works, why it behaves the way it does, and trust the evidence it provides?

Not "is P2Less bug-free" — nothing is. The real test is: **when something's wrong, can you find out why, fix the right layer, and prove the fix worked, without the system fighting you.** That's the standing quality dimension recorded here, and unlike most sections in this document, it's graded against what actually happened in this session, not a hypothetical.

### What a specialist would look for

| Engineer | What would earn confidence |
|---|---|
| Frontend | Predictable navigation, real feedback on every action, useful error/empty states |
| Backend | Consistent server actions, real data integrity, no silent failures |
| Full-stack | Everything connects end-to-end, not feature-by-feature islands |
| DevOps/SRE | Observability, health status, incidents, auditability |
| Security | RBAC, tenant isolation, a real audit trail |
| QA | Reproducible testing, evidence, regression tracking |
| AI/ML | Traceable AI behavior, evaluation, a real feedback→improvement loop |
| Data | Reliable data, provenance, no silent schema drift |
| Developer/Integrator | Clear APIs, documentation that matches the actual product |
| Architect | Clean boundaries, coherent design, not accumulated one-offs |

The concrete version of "traceable": given a wrong AI answer, can you actually walk `User → Channel → Message → Conversation → Intent → AI request → Provider/model → Connector → Response → Finding → Investigation → Fix → Regression test → Verification` end to end, or does the trail go cold partway through? That exact chain is what the System Trace panel (§2, §19) exists to make real, not aspirational — built specifically because the trail *did* go cold at the `Message → what actually happened` step before 2026-08-23.

### Where this session actually earned confidence — specific, not generic

- **A real bug, traced to its exact cause, not guessed at.** The bot-honesty bug (§ the `smallTalk()` fix) wasn't found by inspection — it was found by adversarially asking the AI "are you a bot?", then traced to one literal line in the system prompt (`"never say or imply you are a bot, AI, or automated"`) and fixed at that exact line. A backend/AI engineer reading that fix would see a real root cause, not a patch over a symptom.
- **The System Trace panel took under an hour to build** because the correlation it needed (`AuditLog`/`AiRequestLog`, both already keyed by `requestId`) already existed before anyone asked for a trace view — a sign the underlying architecture was reasoned about ahead of the feature, not that the feature got lucky.
- **Tenant isolation** (`AsyncLocalStorage` + a Prisma extension that auto-scopes every query, see the roadmap doc's tenant-isolation section) is real defense-in-depth at the ORM layer, the kind of thing a security engineer checks for specifically because most apps don't have it.
- **The regression suite is real, not decorative** — 73 HTTP-driven tests that have caught actual crashes (a real compound-unique-key crash during the tenant-isolation work) and were run dozens of times this session with honestly-distinguished results (same failure twice = real bug; a different failure each run = provider-load flake, confirmed by reading the actual assertion every time, never assumed).

### Where this session found real inconsistency — stated honestly, not smoothed over

- **Two schema fields that were never actually wired**: `Conversation.channelId`/`Channel.type` are defined but 0 of 177 real conversation rows use them (§34) — exactly the kind of drift a data engineer flags on sight, and nobody had caught it before this session.
- **A stale schema comment**: `Message.meta` was documented as carrying "intent, action, latency" — no code path ever wrote that. Fixed as part of the `Message.requestId` change (§2), but it was there, misleading, until checked.
- **The bot-honesty bug shipped to production and sat there** until it was adversarially tested — the regression suite didn't catch it because nothing was testing for it. Real coverage of known risks; real gaps in undiscovered ones. Worth being honest that this is a general limitation of any regression suite, not specific to this one.
- **A large gap between the vision documents and shipped reality** — an engineer reading the roadmap/design docs cover to cover would correctly conclude: ambitious direction, real but comparatively small shipped surface. That's true, and stated as true throughout these three documents by design (principle 6) — whether that reads as a strength (honest) or a concern (early) depends on what stage the reader expects, but it should never be the *documentation's* job to hide which one it is.

### The standing rule this section adds

**An experienced software engineer should be able to use, inspect, test, troubleshoot, and understand P2Less without encountering unexplained inconsistencies or unsupported claims.** Not a marketing bar — an operational one, sitting directly on top of everything else in this document: the System Trace panel, the real-vs-vision status legend, the regression-suite discipline, and the "describe what actually protects the system" rule (§1) are the concrete mechanisms that make this bar achievable rather than aspirational.

## 37. Schema-drift audit — applying §36 deliberately, not waiting to stumble on the next one

Direct follow-up to §36: rather than wait to find the next `Conversation.channelId`-style drift by accident, did a deliberate pass across `prisma/schema.prisma` for the same pattern (a field the schema/comments describe as real, that no code path actually writes or reads). Two genuine findings.

**✅ Fixed, shipped 2026-08-23 — `Subscription.paybillReference`.** The real C2B PayBill confirmation webhook (`src/app/api/payments/mpesa/c2b/confirmation/route.ts`) has always looked up the paying tenant by `db.subscription.findUnique({ where: { paybillReference: billRefNumber } })` — but confirmed 0 of 10 real subscriptions ever had that field set, anywhere, by any code path. Every direct PayBill deposit (not preceded by an STK push) was silently falling through to the manual reconciliation queue instead of auto-matching — not a money-loss bug (the manual fallback catches it), but a real, silent efficiency gap doing exactly what the schema comment said the mechanism was built to avoid. Added the missing write side: a `PaybillReferenceField` on `/admin/tenants/[id]`'s Subscription card, gated on `billing.confirm_payment` (the existing permission for payment-matching actions, reused rather than inventing a new one), backed by `setPaybillReferenceAction` (handles the real `@unique` constraint conflict with a clear error, not a raw Prisma exception). Live-verified end to end: set a real value through the UI, then ran the *exact* query the webhook uses — it correctly resolved to the right tenant.

**🔮 Found, deliberately not fixed this round — `NotificationRule.template`.** Lower stakes (notification wording, not payment matching): the field has a real write path (`upsertNotificationRuleAction` sets it) but is dead on both sides in practice — the admin form that calls that action has no input for it at all, and `queueNotification()` never reads `rule.template` or fills its documented `{{tenant}}`/`{{plan}}`/`{{amount}}`/`{{date}}` placeholders; every notification's content is always the literal string the calling code passed in. Fixing this properly means adding the form field *and* building real placeholder substitution — a genuine feature, not a one-line connection like the PayBill fix was. Recorded here so it isn't lost, not built this round.

## 38. "Are we tracking who's online / how the product is used?" — checked precisely, then a small honest fix

Asked directly 2026-08-23. Checked rather than assumed: **✅ confirmed, zero product-analytics or presence tracking exists** — no SDK (PostHog/Mixpanel/GA/Amplitude, none in `package.json`), no heartbeat/WebSocket, no `lastSeenAt` on `Contact` or `User`, no client-side event tracking anywhere (`fetch('/api/track...')` and equivalents: zero hits). `UsageEvent` is real but exists purely for plan-limit enforcement and billing, aggregated nowhere into behavioral analytics. Building the full picture (presence, funnels, feature adoption, retention) would repeat the same premature-infrastructure trap already avoided everywhere else in this document — 177 total conversations, no real paying tenants yet, nothing for a funnel system to meaningfully show.

**✅ Shipped 2026-08-23 — a small, honest exception.** Unlike full analytics, a "recently active" approximation was genuinely cheap because the underlying signal already existed: `UserSession.lastActiveAt` is actually touched on real requests (`auth.ts`, throttled — not just set at login), so "active in the last 15 minutes" is a real signal for staff/admin. There's no equivalent session-activity field for end-user contacts, so that side is approximated differently and honestly — real inbound `Message.createdAt` in the last hour, not the same kind of signal, which is why the admin Overview's new "Right now" card labels the two numbers separately rather than combining them into one fake "N online" figure. Live-verified: showed `1` staff active (the live admin session that loaded the page) and `9` conversations (genuine test activity from this session), both real, neither fabricated.

## 39. Cross-tenant isolation, re-verified live — a clean audit, recorded as real evidence

Requested directly 2026-08-23: does the tenant-isolation extension (shipped 2026-08-22, roadmap doc) actually still hold, or was it only ever proven once and never checked again? A clean audit is still a real finding worth recording, not a non-event — this is exactly the kind of re-verification the Engineering Confidence standard (§36) calls for, done deliberately rather than assumed to still be true.

**✅ REAL — verified, not just re-read.** Two independent tests, live, against real data:

1. **The safety net itself** (a temporary debug route, removed before commit — same pattern as every other live-verification this session): entered Hamzone's tenant context, then deliberately ran the exact "developer forgot to scope" scenario the extension exists to catch — `db.conversation.findUnique({ where: { id: <Riverside's real conversation id> } })`, no `tenantId` in the where clause at all. Result: `null`. Then `db.conversation.update({ where: { id: <same foreign id> }, ... })` → threw `PrismaClientKnownRequestError` (P2025), and a follow-up read confirmed the row was genuinely unmodified. Then the actual point of the feature: `db.conversation.findMany({})` with **no where clause whatsoever**, still in Hamzone's context — returned exactly 15 rows, every one scoped to Hamzone, zero foreign-tenant rows.
2. **The real user-facing path**: logged in as an actual Hamzone dashboard user (not a raw db call), navigated directly to `/dashboard/conversations/<Riverside's real conversation id>` — got a genuine `404`, not Riverside's data. Confirms both layers hold: the ORM-level extension and the page's own explicit `tenantId` scoping.

No fix needed — this round's value is the confirmation itself, done empirically rather than assumed. Worth treating this kind of spot-check as a recurring practice (not a one-time proof), the same way the regression suite gets re-run after every change rather than trusted from one clean run months ago.

## 40. Settings IA — the org-level piece of the large UX proposal, scoped to not duplicate existing pages

Deliberately did NOT build a mega-settings-page with everything the original proposal listed (Account/Security/Notifications/Workspace/Tenant/Channels/WhatsApp/AI/Integrations/Billing/Users & Roles/Branding/System) — Channels, Billing, Users & Roles, and AI/connectors already have their own dedicated pages, and duplicating them would be exactly the kind of redundant system this whole document argues against. Audited `Tenant` model fields first to find what was genuinely homeless: `name`, `industry`, and `branding` (`assistantName`/`logoText`/`primaryColor`/`welcome`/`poweredBy`/`pdfFooter`) are all live-consumed elsewhere (conversation greetings, generated PDFs, the widget embed snippet) but had exactly zero edit path anywhere after signup — confirmed by grepping every `db.tenant.update` call site in the codebase (4 total, touching only `faqs` or `status`, never these fields).

**✅ Shipped 2026-08-23** — new `/dashboard/settings` page + `updateTenantSettingsAction`, gated on the existing `tenant.manage` permission (reused, not invented), with the same dirty-check ("no changes were made") discipline established in Phase 4 of the UX-Consistency audit. Added to the main nav.

**A real bug found live-testing this feature, not introduced by it — fixed the same round.** Setting a new assistant name and testing it had zero effect on WhatsApp/webchat greetings, only on the widget path. Traced to `conversation.ts`: the widget/direct-tenantId routing path correctly computed `assistant = branding.assistantName ?? tenant.name`, but the WhatsApp/number-based routing path unconditionally set `assistant = num.displayName`, completely bypassing the `branding` merge computed one line earlier — dead code for the majority real channel. Fixed to `assistant = branding.assistantName ?? num.displayName`, matching the existing comment's own stated intent ("per-number branding wins"). Live-verified: same fresh-contact greeting test, before the fix said "You've reached Hamzone Technologies," after said "You've reached Zuri."

**🔮 Explicitly not built this round**: `useCases`/`channelsNeeded` editing. Correction to an earlier sub-agent's claim while investigating this — these fields are NOT dead data; `dashboard/layout.tsx` reads them to decide which nav groups (commerce/integrations/developer/widget) show for a tenant. A tenant that under-selected at signup has no way to reveal hidden nav sections except by organically generating the underlying data signal. Real, worth adding to Settings eventually, deferred this round to keep the change reviewable — not because it's low-value.

## 41. Training Sessions v1 — shipped, with a real isolation bug caught and fixed before it ever reached production

Minimal v1 of the Test Exercise design (roadmap doc's TestExercise section): a named `TrainingSession` per tenant (`name`, `questionsPerParticipant`, `status`), and a `TrainingParticipant` row per (session, contact) with an atomically-incremented `questionCount`. Deliberately deferred from v1: participant caps on session size, stated objectives, the full session lifecycle (paused/scheduled states) — real future scope, not forgotten, just not needed to prove the core workflow.

**🐛 A real bug, caught before shipping, not after.** The first working version gated *every* contact who messaged a tenant while that tenant had an active session — meaning a genuine customer, never enrolled in anything, would have been silently swept into the training question counter and eventually hit with "you've reached your allocated question limit," a nonsensical and broken experience for someone who was never testing anything. Caught while mid-way through live-verifying the feature, before any commit or deploy. This is exactly the failure mode named directly by the user while the fix was already underway: *"Admin clicks Training → WhatsApp becomes Training → Everyone is now testing"* — never implement that.

**✅ Fixed and shipped 2026-08-23.** Enrollment is now explicit: a `TrainingParticipant` row must already exist for a contact before their messages are gated at all — an admin adds a specific phone number to a session (`addTrainingParticipantAction`, resolves/creates the same `Contact` row `conversation.ts` would use for that number normally). The gate in `handleInbound()` no longer starts from "is there an active session for this tenant" — it starts from "does a `TrainingParticipant` row already exist for this exact contact," and does nothing at all if not. A contact who was never enrolled is completely unaffected by an active session, full stop — this is the actual mechanism behind the standing principle: *a tester entering training changes that tester's context, never the production channel or a real client's experience.*

**Live-verified, all five states, via real webhook-style calls against the running dev server:**
1. An unenrolled contact messaging a tenant with an active session got a completely normal reply — no training text, no counting.
2. An enrolled tester's first message (1 of 2 allowed) got a normal reply.
3. Their second message (2 of 2) got the normal reply *plus* the near-limit "did you find anything?" prompt, appended via `emit()`'s single funnel.
4. Their third message was hard-blocked — a single "you've reached your allocated question limit" reply, no AI/connector work run at all.
5. After the admin ended the session, the same tester's next message got a normal reply again — the gate is genuinely lifted, not just suppressed.
6. Re-confirmed the original unenrolled contact was still unaffected throughout, including after the enrolled tester hit their limit.

Full 73-test regression suite run twice post-fix: 72/73 both times, a different single test failing each run (a webhook-delivery timing test, then an unrelated menu-capability test) — consistent with this session's established discipline that a different failure each run is provider/timing variance, not a regression, versus the same failure twice which would be treated as real.

**✅ Also shipped same day — `maxParticipants` cap.** Asked directly: are "participants" and "questions" the same control? No — they were already two separate dimensions in the data model (`questionsPerParticipant` is per-person; enrollment count is separate), but there was a genuine gap — nothing capped how many phone numbers an admin could enroll at all. Added `TrainingSession.maxParticipants` (nullable = no cap), enforced atomically in `addTrainingParticipantAction` inside the same `$transaction` pattern as the question counter (the count-then-insert race matters less here since enrollment is single-admin-driven rather than many concurrent senders, but the standard is applied consistently rather than judged case-by-case). Live-verified: a session capped at 1 accepted the first enrollment (`1/1`), rejected the second with "This session is full," and the UI shows `N / cap` when a cap is set.

**🔮 Explicitly not built**: the richer capacity model from the same round — target vs. maximum as two distinct numbers (not just one cap), renaming "questions" to "interactions" ahead of planned audio/image/video testing, a per-type interaction breakdown, and computed session-level stats (potential findings, verified findings, average interactions/participant). Real and specific enough to implement directly when needed; not built now to keep this addition reviewable on its own.

**🔮 Access mode (invite-only / public / invite+public) — raised, not built, with a real constraint attached.** Confirmed directly: v1 is invite-only only — a `TrainingParticipant` row must already exist, nothing is public by default (§41). A public/open mode was proposed as a session-level setting. The real constraint worth recording before anyone builds this: Hamzone's WhatsApp number is simultaneously the live customer number *and* the number used for pilot-tester recruitment (the "Recruit pilot testers" card on this same page) — so "auto-enroll anyone who messages, up to a cap" on that same number cannot distinguish a genuine first-time customer from a public tester without an explicit join signal (a keyword, a session code, or a separate entry point). Public mode is not just a UI toggle for this reason; it needs that join mechanism designed first, or it silently reintroduces the exact identity-ambiguity problem §41's fix exists to prevent.

## 42. Continuous testing alongside real clients — recorded as VISION, not built, so it isn't lost

Two large design proposals arrived in the same round as §41's build, both worth recording precisely rather than losing to a "continue" a few messages later. Neither is built. Both are genuine, both are premature for a single-founder, pre-launch product with [zero real paying clients as of 2026-08-22](project_p2less_gtm_strategy.md) — but the moment that changes, this section is where to start.

**A. Personal Training/Live context, isolated from production — the permanent post-launch operating model.** The core architecture proposed: dedicated tester identities (not a normal staff role — a distinct "Testing Participant"/"QA Tester" kind of account with an explicit capability allow-list: can enter sessions, submit findings, test *approved* production capabilities; cannot change production config, tenant permissions, or deploy), a personal per-tester Live/Training toggle (switching one tester's context, never the tenant's or a real client's), a knowledge/config staging-and-promote flow so a proposed FAQ or prompt change is tested against a copy before being promoted to what real clients see, and a Quality Centre view that links a training-session finding to matching production telemetry ("we found this in controlled testing, and 3 real customer conversations show the same behavior") — plus keeping training and production usage statistics separate so product analytics never conflates the two. The closing principle, stated directly and worth keeping verbatim as the standing rule for whenever this gets built: **a tester entering Training must change that tester's context, not the production state of the channel or the experience of real clients.** §41's fix is a first real instance of this principle, not the full architecture — no dedicated tester identity type exists yet (enrollment today is just a phone number on a `TrainingParticipant` row), no staging/promote flow for knowledge or prompts exists, and findings aren't yet linked to matching production telemetry.

**B. A platform-level operating-mode / feature-flag system — registration, onboarding, and login as controllable switches, with a full audit trail.** Proposed as a 3-tier system: a system-wide operating mode (PRE-LAUNCH / PRODUCTION / MAINTENANCE), per-feature controls (registration, onboarding, login, each channel) respected by both UI and backend, and per-training-session controls — plus required-reason confirmation dialogs and a full audit log of every toggle. **Grounded check, not hypothetical**: this risk was real, not abstract — `/onboard` (`src/app/onboard/page.tsx`) is a live, public, self-serve tenant-creation route; anyone with the link could create a tenant, hardened against trial abuse (roadmap doc's 5 trial-abuse items) but with no master off switch. **The single-flag piece shipped 2026-08-23 — see §43.** The rest of the proposal (three operating modes, three tiers of controls, per-channel kill switches beyond this one, mandatory reason fields platform-wide, a dedicated audit UI beyond the existing privileged-action log) remains real infrastructure for a team running change control over many toggles — still premature for one founder pre-launch, still recorded here rather than built.

## 43. Public registration off switch — extended the existing settings system, not a new one

Directly requested 2026-08-23, following the "we don't want complexity, we want everything to flow and make sense" instruction given the same round: the single flag recommended in §42-B, closing the real exposure named there. Deliberately built by extending `src/lib/platform-settings.ts` — a general-purpose, super-admin-editable key/value settings store that already existed and already followed the exact right shape (every key has a built-in default, nothing changes for an existing deployment until an admin actually edits it) — rather than inventing a second settings mechanism. `maintenance_enabled` (whole-platform maintenance) already lived there; `public_registration_enabled` is now a sibling key in the same table, same defaults philosophy, same admin page.

**What it is**: `public_registration_enabled` (default `1`, i.e. today's real behavior is unchanged until an admin acts). Enforced in two places, both required — hiding the UI alone would let a direct call through: (1) `src/app/onboard/page.tsx` reads the setting server-side and shows a plain "signups are currently paused" message with a sign-in link instead of the form; (2) `requestOnboardOtpAction` (`src/lib/actions.ts`) checks it as the very first thing, before any OTP is issued or SMS sent, so a direct call to the action is blocked identically to the UI. Toggled via `setPublicRegistrationEnabledAction` (`src/lib/maintenance-actions.ts`) — reuses the existing `maintenance.manage` permission (held by `super_admin` and `security_admin` only) rather than inventing a new one, matches the simpler reason-required-but-no-typed-confirmation pattern already used for individual integration toggles (lower blast radius than whole-platform maintenance, which does require typing a confirmation phrase), and goes through the same `logPrivilegedAction` audit trail every other admin action here does. Surfaced as a `RegistrationCard` on `/admin/system-health`, directly beside the existing `MaintenanceCard` — same page, same visual language, same permission gate, because it's the same category of control: a platform-wide risk switch, not a new one.

**Live-verified**: default state is "open" (form renders normally). Toggled off via the admin card → `/onboard` immediately showed the paused message instead of the form, no code deploy needed. Toggled back on → the form reappeared. Full 73-test regression suite run clean after the change.

**Deliberately not built**: the richer 3-tier system named in §42-B (operating modes, per-channel kill switches beyond this one, mandatory reason fields platform-wide, a dedicated audit UI). This one flag closes the actual named exposure; the rest stays recorded as vision until there's a real reason — a team, not one founder, running change control over many toggles — to justify it.
