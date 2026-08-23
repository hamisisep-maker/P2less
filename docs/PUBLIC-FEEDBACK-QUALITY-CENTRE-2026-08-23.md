# P2Less — Controlled Production-Learning Loop (Public Feedback → Quality Centre)

Proposed by the user 2026-08-23, refined against the actual current state of the codebase, then refined a second time against a detailed follow-up review. **The six governing principles below are now agreed as a formal P2Less system standard** — the philosophy of evidence-before-correction applies from today, to any AI-quality investigation, not just ones that come through this specific programme. **The channels/rollout/implementation stays "not started" — vision + phased plan only**, same discipline as every other future-strategic item in this project (see the main roadmap doc's Phase 8b/candidate-channels sections for precedent). Don't conflate the two: the standard is adopted now, the public programme that feeds it is still unbuilt.

**Framing, deliberately not "a bug-hunting campaign":** this is P2Less's controlled production-learning loop — a structured, engineering-discipline pipeline from real conversations to verified corrections, not a community bug-bounty event. The public channels are only the input layer; the actual product is the review, evidence, attribution, correction, and regression-testing system behind them.

```
          PUBLIC / TENANT / INTERNAL REPORT
                        ↓
              Existing SupportTicket
           (source: public_report | tenant | internal)
                        ↓
               Quality Classification
                (11-category taxonomy, below)
                        ↓
                Evidence Collection
                        ↓
               Execution Fingerprint
       (conversation → message → AiRequestLog →
        provider/model → connector → intent → auth)
                        ↓
                  Human Review
             (the investigation waterfall)
                        ↓
              ┌─────────┴─────────┐
              ↓                   ↓
          Verified              Not a Bug
              ↓             (documented, closed —
      Corrective Action      no system change)
   (prompt fix / FAQ / code / config —
    never a raw "add this fact" write)
              ↓
        Regression Test
   (the same scripts/test.ts suite
    this whole session has run after
    every single fix)
              ↓
           Monitor
```

**The philosophy this reduces to**: people don't teach the AI directly. People provide evidence. P2Less investigates the evidence, identifies the actual failure, fixes the appropriate layer, tests the fix, and only then allows the verified knowledge or configuration to influence future behavior.

## The six governing principles — the formal standard

These apply to any AI-quality investigation at P2Less from today, whatever channel or source the report came from.

**1. Evidence before classification.** A report is an allegation until the underlying execution has actually been investigated — never triage from the description alone.

**2. Human review before learning.** Nothing reported by a user automatically changes prompts, FAQs, configuration, or AI behavior. Every correction passes through a person first.

**3. Identify the origin of the error.** The investigation must determine which layer actually produced the failure — source data, connector, authorization, intent/classification, conversation context, AI generation/transformation, integration, technical infrastructure, or user misunderstanding. This is what the 11-category taxonomy and the investigation waterfall below exist to enforce.

**4. Preserve existing invariants.** The AI layer already has explicit, hard rules about what it must never do — not just the number-preservation rule in `humanizeReply()`. Grepping `ai.ts` turns up several, all worth a reviewer's checklist when classifying a report as a genuine AI-generation violation rather than something else:
   - *"Keep every number, amount, currency, date, time, reference and name EXACTLY as given in the ANSWER"* (`humanizeReply()`)
   - *"Never invent ORGANIZATION-SPECIFIC or PERSONAL details you weren't given"* (`smallTalk()`)
   - *"NEVER offer to 'check', 'ask', 'find out', or 'get back to you' on something... Fabricating a check-in and its outcome is a real lie to someone who trusted you"* (`smallTalk()`)
   - *"Never invent whether something DID or DIDN'T happen"* (`smallTalk()`)

   A verified violation of any of these is a confirmed integrity failure, not a vague "AI was off" — and this list itself is worth keeping current as the AI layer grows, since it's the actual definition of what "preserve invariants" checks against.

**5. Every verified fix should be testable.** A confirmed fix should produce a regression test where practical, so the same failure gets caught automatically if it returns — the same discipline this whole session has applied to every single shipped fix via `scripts/test.ts`.

**6. Capability is evidence-gated — and this applies project-wide, not just to this programme.** Don't claim a capability because the code exists; claim it once the complete user journey has been proven. This is the exact standard already applied to every channel-readiness call in this document, and it's the same standard this whole session used on the widget itself (an embed script claiming to load asynchronously when it didn't, a widget claiming file-attachment support on channels that don't have it) — worth stating explicitly as a standing rule for any future externally-visible P2Less capability, not just something applied implicitly.

## The core idea, and why it's right

Publish "found something wrong with P2Less? tell us" across the channels the assistant runs on, so real usage surfaces bugs and hallucinations faster than internal testing alone can. The user's own most important constraint on this idea is the correct one and should never be relaxed:

> **A report never automatically teaches the AI.** It always goes through a human review step first.

This isn't caution for its own sake — it's the same "never invent, always ground" discipline this entire session's bug-hunting has been enforcing on the AI itself, applied one layer up. If "P2Less told me my school has 500 students" got auto-ingested as a corrected fact, that would be a worse failure than the hallucination it was meant to fix. Every report must resolve through: **what was asked → what did P2Less answer → what data did it use → what should the answer have been → why did it fail** — before anything changes.

## Reality check: channel readiness, checked against this session's own work, not assumed

The proposal names 8 channels. Their actual state today is uneven — publishing an invitation on a channel that doesn't work yet is exactly the class of bug this whole session has spent rounds fixing on the widget, just pointed outward at the public instead of inward at the product.

| Channel | Real status | Fit for a public launch today? |
|---|---|---|
| **Website widget** | Live on the landing page, most battle-tested surface this session (28 FAQs, 11 bug-hunt rounds) | ✅ Ready |
| **WhatsApp** | Fully working, but self-service number onboarding (Phase 9) is still paused | ✅ Ready (existing numbers), self-signup not yet |
| **Facebook Messenger** | One real connected Page; inbound round-trip still unproven (blocked on a Meta dev-mode Tester-role restriction) | 🟡 Needs the Tester invite resolved first |
| **Telegram** | Fully built; never tested against a real `@BotFather` bot | 🟡 Needs a real bot + one real end-to-end test |
| **Email** | Fully built; Resend inbound isn't configured in production | 🟡 Needs `RESEND_INBOUND_DOMAIN`/`RESEND_WEBHOOK_SECRET` set |
| **Instagram** | Blocked on Meta App Review — not started | ❌ Not ready |
| **TikTok** | Not a channel — explicitly researched and deferred earlier this session | ❌ Doesn't exist |
| **X/Twitter** | Not a channel — researched, not built. If built, X bills **both directions** of a DM exchange (~$0.010 receive + ~$0.015 send ≈ $0.025/round trip) — open public traffic here has a real, uncapped cost, not just an engineering cost | ❌ Doesn't exist, and isn't free even once built |
| **SMS** | Wired up for OTP/notification delivery only — not a two-way conversational channel today | ❌ Not a channel to report through |

**Recommendation: launch on the 1-2 channels that are actually ready (widget, WhatsApp), expand per-channel only as each one is genuinely proven** — not a simultaneous 8-channel announcement. A channel earns its place on the public invitation the same way every fix this session earned a ship: live-verified first, announced after.

## A second real constraint: screenshots don't work everywhere yet

"Attach a screenshot" only works reliably on **WhatsApp** today — it's the only channel with file-attachment support wired up (confirmed via `currentChannelSupportsFiles()` in `tenant-context.ts`). Messenger/Telegram/Email/Widget are all text-only right now. On those channels a reporter can only describe the bug in words unless attachment handling gets built out for them too — a real, separate piece of scope, not assumed to already work.

## Don't build a parallel system — extend what already exists

P2Less already has a real ticket/incident workflow: `SupportTicket`, `TicketEvent`, an admin tickets/incidents workspace with status tracking, assignment, SLA deadlines, and audit logging. The "Quality & Feedback Centre" described in the proposal is structurally the same thing, scoped to AI-quality issues specifically. Building a second, disconnected reporting system would duplicate real, working infrastructure for no benefit.

**Recommended shape**, additive to what exists rather than replacing it:
- `SupportTicket` gains a `source` field — **three values, not two**: `"internal"` (P2Less's own team found it), `"tenant"` (a tenant's own staff reported it — this already happens informally today), `"public_report"` (a member of the public reported it through this programme). Distinguishing all three matters later: a pattern that only shows up in public reports vs. one tenants themselves keep hitting are different signals.
- A `category` field, nullable until triaged (see the refined taxonomy below) — starts as `unknown_investigating` on intake, never left to default to a guess.
- A new optional link from a ticket to the `Conversation`/`Message` it's actually about — **set by the reviewer manually** during triage (picking from that conversation's recent messages), not auto-detected. Automated fingerprint-matching (guessing which message a screenshot refers to) is a real inference problem of its own and risks mis-linking reports to the wrong exchange — not worth building until manual linking proves the workflow is valuable.
- The existing `AiRequestLog` (provider, model, cost, latency) is already keyed to a conversation/tenant — once a ticket is linked to the right message, the AI-execution trace (which provider/model answered, what FAQ or connector it drew from) is already sitting right there, no new logging needed.

This reuses real, already-audited infrastructure instead of inventing a parallel one, and keeps a public bug report inside the same review/assignment/SLA machinery your team already uses for everything else.

## The investigation waterfall — what a reviewer actually checks, in order

Every report resolves through this sequence before anything gets corrected. Each step maps to a real, already-existing piece of this codebase, not a new system:

1. **What did the user ask?** — the raw inbound `Message`.
2. **What did P2Less understand?** — the matched intent/action from `understand()`/`matchIntent()` in `conversation.ts`.
3. **Which tenant, which contact?** — `Tenant`/`Contact`, already tenant-isolated.
4. **What authorization happened?** — the permission/step-up check that ran (or should have) before anything sensitive was released.
5. **Which resource was resolved, which connector was called?** — the `ConnectorAction` invoked and its real parameters.
6. **What did the connector actually return?** — the raw upstream data, before the AI touched it.
7. **Which AI provider/model was involved?** — pulled straight from `AiRequestLog`.
8. **What response was generated, and does it match what the connector returned?** — the pivotal check (see below).
9. **What should have happened?** — the reviewer's verified conclusion, which drives the category and the fix.

**Step 8 is the single most important check, and it's why the taxonomy needs to split "wrong data" from "AI changed correct data."** Three ways a loan-balance report can resolve, and only one of them is actually an AI problem:

```
Connector → 40,000        Connector → 50,000        Connector → 40,000
     ↓                          ↓                          ↓
  AI → 40,000               AI → 50,000                AI → 50,000
     ↓                          ↓                          ↓
User receives 40,000     User receives 50,000     User receives 50,000

    ✅ Correct              ⚠️ Source-data /           🔴 AI transformation
                            connector problem              violation
```

If the connector returned 50,000, the AI faithfully repeating it is not an AI defect at all — the fix is upstream, in the connector or the source system. If the connector returned 40,000 and the reply said 50,000, that's the serious case: `humanizeReply()` in `ai.ts` has an explicit existing rule — *"Keep every number, amount, currency, date, time, reference and name EXACTLY as given in the ANSWER"* — so a verified instance of the third diagram isn't merely "the AI hallucinated," it's a confirmed violation of a rule the system already has specifically to prevent this. Rare, high-priority, and worth its own category rather than being lumped in with ordinary hallucinations.

## Triage taxonomy — refined to 11 categories, each mapped to a real fix path

The original 6-category version conflated a few genuinely different failure modes. This is the corrected version — it prevents the team from blaming the AI for problems that actually originate elsewhere:

| Category | What it means | Real example / fix path in this codebase |
|---|---|---|
| 🐛 Technical Bug | A real code defect, nothing to do with the AI | A code fix (e.g. this session's `menuPrompt()` structural fix, the crawler's silent-failure-mislabeled-as-content-problem fix) |
| 🤖 AI Hallucination | The AI generated something not present in its grounded inputs — including corrupting a correct number/fact during rephrasing | A prompt/instruction fix in `ai.ts` (e.g. the zero-capability topic-guessing fix) — reserved specifically for cases like step 8 above, not a catch-all |
| 📚 Knowledge Gap | Correct info wasn't available to ground an answer at all | A new/corrected FAQ entry in `landing-content.ts` or the tenant's own FAQs |
| 🗄️ Incorrect Source Data | The connector returned exactly what the external system has, and that system's own data is wrong | Not a P2Less fix — flag back to the tenant's own system/data owner |
| 🔄 Incorrect Connector Result | The external system's data was fine, but P2Less's connector fetched/transformed it wrong | A connector-config fix, not an AI-layer change at all |
| 🎯 Intent/Classification Error | The AI picked the wrong action entirely (e.g. matched "leave balance" when asked about "payslip") — a routing failure, not a fabrication | A fix to `understand()`/`matchIntent()`'s matching logic or prompt |
| 🔐 Authorization Error | A permission/step-up check let something through it shouldn't have, or blocked something it shouldn't have | An RBAC/permission fix, always logged via the existing audit trail |
| 🔌 Integration Failure | The connector call itself failed (timeout, malformed request, external system down) | Matches this codebase's existing "honest failure when payroll is down" pattern — already tested in the regression suite today |
| 💬 Conversation/Context Failure | A fact given earlier in the conversation got lost or misapplied | Real precedent already shipped: round 9's fix for facts falling out of the retained history window, causing a false "you never told me that" |
| ❓ Correct Response — User Misunderstanding | The system behaved correctly | No system change — documented and closed, same as this session's "investigated, not a bug" findings |
| 🔎 Unknown / Requires Investigation | Intake default — never guess a category before the waterfall above has actually run | Starting state for every new report, not a real resolution |

**Worth being precise about, since the phrase "help the AI learn" can be misread**: nothing in this system means retraining or fine-tuning a model. Every AI-layer fix this entire session has been either a system-prompt instruction change or a new grounded fact (FAQ) — that's what "fixed" means here, and the Quality Centre should make that explicit to reviewers rather than implying something more exotic is happening.

## Phased rollout

**Phase A — prove the workflow small, not public.** Extend `SupportTicket` with `source`/`category`. Build the triage dashboard view (grouped by category, same visual language as the existing incidents/tickets workspace). Pilot with a small, deliberately-recruited group — not a public blast — reporting through WhatsApp and the widget only, the two channels that are actually solid. A sample recruiting message, since "try to break it" framing gets better reports than a generic feedback request:

> *Try to break it. If P2Less gives you something wrong, confusing, unexpected, or suspicious, report it here.*

Confirm the manual-linking and categorization workflow is fast enough to be worth using day-to-day before it's advertised anywhere.

**Phase B — public invitation, still just the two ready channels.** Publish "found a bug? tell us" on WhatsApp and the widget once Phase A proves out. This is the point where the public sees it for the first time.

**Phase C — expand per-channel as each one becomes real, evidence-driven, not scheduled:**

```
WhatsApp → Proven → Widget → Proven → Telegram → real-world tested → Proven
   → Email → Proven → Messenger → ...
```

Each arrow is a real, independent milestone from the main roadmap, not a calendar date — Messenger once the Tester-invite/round-trip is proven, Telegram once a real bot is connected and tested, Email once Resend inbound is configured. A channel gets added to the public invitation only after its own operational test passes, matching the standard this whole session has actually applied everywhere else: **don't claim a capability because the code exists — claim it once the complete user journey has been proven.**

**Not planned, explicitly**: Instagram, TikTok, X/Twitter, SMS-as-a-conversational-channel. Revisit only if one of those channels gets built for its own real product reason first — a public bug-bounty invitation is never itself the reason to build a new channel.

**Phase D — long-term, aspirational only, not scoped.** Once enough verified reports accumulate, the Quality Centre stops being just a ticket queue and starts answering operational questions directly — a real dashboard view, something like:

```
P2LESS QUALITY

Total conversations       48,291
Quality reports               382
AI quality rate              99.2%

Most common issue:        Knowledge gaps (41%)
Most affected intent:     Loan inquiries
Most affected provider:   Provider X
Recurring issue:          "Loan balance responses" — 17 occurrences across 6 tenants
Regression failures:      3
Unresolved critical:      1
```

This only becomes real once real volume exists to compute it from — explicitly not part of Phase A-C, and not worth designing in detail until there's actual data to shape it around.

## Open questions only the user can answer

1. **Review capacity.** This is presently a solo-founder operation. A public invitation across even 2 channels can generate real volume — is triaging reports a sustainable ongoing task right now, or should Phase A stay internal/invite-only for longer than one pilot round?
2. **Tenant scope.** Is this feedback programme about the P2Less *platform itself* (the self-tenant, the widget on the landing page) or about *every tenant's* deployment (Riverside, Hamzone, etc.)? These are different audiences and probably need different intake copy — the current proposal reads as platform-level, worth confirming.
3. **Data handling.** A screenshot or forwarded message from the public could contain another real person's private information (someone else's loan balance, a student's results). Worth a stated policy on how those get stored/reviewed/retained before this goes live, not after.
