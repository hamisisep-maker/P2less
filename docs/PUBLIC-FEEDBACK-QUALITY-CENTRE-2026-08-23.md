# P2Less — Controlled Production-Learning Loop (Public Feedback → Quality Centre)

Proposed by the user 2026-08-23, refined against the actual current state of the codebase, then refined a second time against a detailed follow-up review, then extended a third time to formalize the **Evidence & Assurance subsystem** (below) as the layer this whole pipeline actually converges into, then locked in a fourth time with the single-convergence-point architecture (`SupportTicket` as the one shared record both a test exercise and a public report resolve through) and the four-term glossary (`SupportTicket`/`Finding`/`TestExercise`/`AssuranceReport`), then extended a fifth/sixth time to cover how a verified fix gets measured (the correction-routing ladder, per-dimension evaluation, cost/ROI) and how multimodal input (audio/image/video) extends the same model once those capabilities exist. **Phase A itself has now actually started** — see the "Phase A — shipped" note below. **A companion document now exists**: `docs/OPERATIONS-GUIDE-2026-08-23.md` — this document explains *why* the system is designed this way; that one explains *how to actually operate it*, real-vs-vision checked line by line against the shipped code. **The six governing principles are agreed as a formal P2Less system standard** — the philosophy of evidence-before-correction applies from today, to any AI-quality investigation, not just ones that come through this specific programme. **The channels/rollout/implementation, and the Evidence & Assurance subsystem's data model/dashboard/PDF report, all stay "not started" — vision + phased plan only**, same discipline as every other future-strategic item in this project (see the main roadmap doc's Phase 8b/candidate-channels sections for precedent). Don't conflate the two: the standard is adopted now, everything that produces or presents evidence under it is still unbuilt.

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

**A sharper way to state principle 2, added on this third pass: chat is evidence, not the assurance layer itself.** A `SupportTicket`, a forwarded screenshot, a WhatsApp message reporting a bug — none of that is, by itself, proof P2Less works. It's raw material. The **structured, reviewed, testable records** that come out the other end of the waterfall below — a confirmed finding, a fix, a regression test that passes — are the actual assurance layer. This distinction is the reason the [Evidence & Assurance subsystem](#evidence--assurance-subsystem-the-layer-this-converges-into) exists as its own section further down: it's what turns "we got a report and looked into it" into something a government or enterprise client could actually be shown.

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

## Evidence & Assurance subsystem — the layer this converges into

Proposed by the user as a third extension: formalize **P2Less Evidence & Assurance** as a subsystem alongside Support/Ticket/Incident and AI Quality — not a separate product, but the layer that turns everything above into something reportable to a tenant, a prospect, or a government/enterprise buyer. Real, adopted as direction. **Not built** — no new models exist yet, this is entirely design.

### Two evidence origins, one pipeline — locked in as the architecture

Everything upstream of this section already produces one kind of evidence: a **report** — something a person (public, tenant, or internal) noticed and flagged. That's *reactive* evidence. The proposal adds a second, *proactive* kind: a **test exercise** — a deliberate, planned round of checking specific things, run by the team itself, whether or not anyone reported a problem.

These aren't different systems, and — refined on this fourth pass — they don't stay parallel past the very first step either. Both origins funnel into the *same* operational record before anything else happens, so there is exactly one convergence point, not two:

```
                    P2Less Quality System
                           │
          ┌────────────────┴────────────────┐
          │                                 │
      Test Exercise                    Public Feedback
          │                                 │
          └────────────────┬────────────────┘
                           ↓
                    SupportTicket
                           ↓
                     Finding
                           ↓
                    Verification
                           ↓
                       Fix
                           ↓
                  Regression Test
                           ↓
                 Verified Evidence
                           ↓
              ┌────────────┴────────────┐
              ↓                         ↓
       Internal Evidence          Client Evidence
                                        ↓
                              Assurance Report / PDF
```

A test exercise that finds a bug and a public report both become a `SupportTicket` first — the exact same waterfall, taxonomy, and fix→regression-test→ship loop already defined above applies either way, no second review process. The only difference is *how the ticket was opened* — worth keeping visible (`source: internal | tenant | public_report`, already recommended above) because "we found this ourselves, proactively, before anyone hit it" is a genuinely different signal to a client than "a user hit this in production," not because it needs different machinery.

Concretely, this session's own work already fits the shape: each of the 11 widget bug-hunt rounds this session ran was a real test exercise — planned, dated, scoped to specific things, with real findings, real fixes, and real regression tests. If this schema existed today, those 11 rounds would already be 11 real historical records, not a hypothetical example — worth retroactively entering once the model exists, so the subsystem launches with a real seed dataset instead of an empty table.

### The critical distinction — four terms, not synonyms

- **`SupportTicket`** — the operational record. What was opened, by whom, when, current status.
- **`Finding`** — the verified conclusion. What the investigation actually determined, once a human has looked at the evidence — not what was alleged at intake.
- **`TestExercise`** — the structured testing activity that produced a ticket, when the origin was proactive testing rather than an incoming report.
- **`AssuranceReport`** — the presentation of accumulated, already-verified evidence. Never a place where a new claim originates.

And the sentence that governs all four, kept prominent because it's the one thing this entire subsystem exists to enforce: **chat is evidence, not the assurance layer itself.**

### Proposed shape (design only, not scoped for build)

Additive to the `SupportTicket`/`TicketEvent` extension already recommended above, not a replacement:

- **`TestExercise`** — a planned round of testing, parent of `SupportTicket` rows opened during it. To make the eventual report feel like a real assurance artifact rather than a marketing PDF, worth capturing from the start once this is built: **who conducted it, when, against which environment/tenant, which version/build, what scope, which test cases were actually executed, and who verified the results.** Preserved here now specifically so it isn't lost by the time this gets built. Also worth preserving from a later elaboration of this same idea (2026-08-23): a formal, budgeted "training session" shape (start/end time, participant/question limits, a lifecycle from draft through completed) is a real, sharper version of "a planned round of testing" than a bare exercise record — and its most valuable piece is **re-running the identical exercise before and after a fix and comparing the two runs side by side** (same question set, same scope), a stronger evidence shape than one before/after evaluation number in isolation. Still the same deferred item, not new scope — elaborated, not expanded. Two more technical specifics worth preserving precisely, since they're the kind of detail that's easy to get wrong if not written down before someone builds this fast later: (1) **target vs. maximum participants are different numbers** — "we'd like 200" and "never admit a 201st" are separate controls, not one; (2) **enrollment and per-participant question limits must be enforced atomically on the server**, not via a naive "count rows, then insert if under the limit" check — that has a real race condition under concurrent joins/questions and would let the hard maximum be exceeded exactly when the session is busiest.
- **`TestCase`** — an individual check within an exercise, with a pass/fail result.
- **`Finding`** — the verified unit of evidence, attached to a `SupportTicket` once triage/investigation is complete (the same waterfall/taxonomy above, regardless of whether the ticket originated from a test exercise or a public report).
- **`AssuranceReport`** — a generated (never hand-assembled) snapshot over a date range: which exercises ran, which findings were confirmed, which were fixed and regression-tested, computed straight from the rows above.

This is a real schema addition — four new models, not the two fields (`source`/`category`) Phase A below already commits to. Worth being honest about the size difference: Phase A is an afternoon's migration; this is its own design-and-build effort, only worth starting once Phase A/B have produced enough real findings for a `TestExercise`/`Finding` model to have something to hold.

### The one rule this section exists to enforce

> **Don't manufacture a "97.8%" score unless the underlying methodology actually supports it.**

This is the user's own stated caution, and it's exactly the right one — it's principle 6 (capability is evidence-gated) applied to the reporting layer itself. Concretely: every number that ever appears on a dashboard or in a PDF must be a live query result over real `TestExercise`/`TestCase`/`Finding` rows — never a typed-in figure, never rounded up for effect. If the underlying data can't support a claim, the report should say "not yet measured," not omit the gap or paper over it with a softer-sounding number. This is the same discipline the taxonomy above already applies to individual findings, now applied to the aggregate.

**The concrete test for whether a report is honest, worth keeping as the acceptance bar**: it should be able to say *"This report contains 137 verified findings originating from 4 testing exercises and 82 user feedback reports"* — every number traceable back to a real count of real rows — never a polished document whose numbers were manually entered.

**Status update, 2026-08-23**: the atomic-enrollment concern raised above is no longer purely a design note — a minimal `TrainingSession`/`TrainingParticipant` v1 shipped, atomically enforced exactly as described, plus a real isolation bug caught before it reached production (an active session was initially gating *every* contact who messaged the tenant, not just enrolled testers — fixed to explicit per-contact enrollment). The permanent continuous-testing-alongside-real-clients architecture (dedicated tester identities, a personal Live/Training toggle, knowledge/config staging-and-promote, findings linked to production telemetry) and a separate platform-level registration/onboarding kill-switch proposal were both recorded as VISION, not built. Full detail in `docs/OPERATIONS-GUIDE-2026-08-23.md` §41–§42 — not duplicated here.

### Presentation tiers

The same underlying records, filtered differently by audience — this is also the first concrete answer to open question 3 below (data handling):

- **Internal** — everything: raw findings, conversation links, provider/model detail, unresolved issues in progress.
- **Client (tenant-facing)** — only that tenant's own findings and resolutions, redacted of any other tenant's data, cross-tenant patterns, or internal-only detail (provider costs, staffing, unrelated incidents).
- **Executive / government** — the PDF-report tier: a summary appropriate for someone deciding whether to trust the system, not operate it. Testing coverage, verified-and-fixed counts, time-to-resolution, no raw conversation content.

### PDF reports — a real head start, not new technical territory

`src/lib/documents.ts` already generates branded PDFs today (`generateReceiptPdf`, using `pdfkit` with a shared header/footer/`storeLongLived` pattern) for payment receipts. An Assurance Report PDF is the same infrastructure — a new document type in the same file, following the same pattern — not a new dependency or new capability. What's actually new is the *content*: a multi-section report (testing summary table, findings-by-category, resolution/regression status) needs real `TestExercise`/`Finding` data to render, which is the actual reason this waits on Phase A/B, not the PDF mechanics.

### Sequencing — explicitly gated, same discipline as Phase D below

This subsystem is a formal part of the roadmap now, not a vague someday. But building the dashboard/report layer before there's real evidence volume behind it is the "manufactured score" trap in a different shape — an impressive-looking empty pipe. Order matters:

1. Phase A/B (below) ship and produce real, triaged `SupportTicket` findings.
2. Once there's a real body of findings, add `TestExercise`/`TestCase`/`Finding` and retrofit this session's own 11 rounds as the first historical records — a real seed dataset, not synthetic.
3. Only then build the Internal tier view (a query over real rows — cheapest, least risky first step).
4. Client tier, once a real tenant relationship needs it.
5. The PDF generator and Executive/government tier, once there's a real prospective client or pilot to show it to — this is a sales-enablement artifact, and it earns its build the same way a channel earns its place in Phase C: proven need first, not built speculatively ahead of one.

The Phase D dashboard sketched below is what the Executive tier eventually renders — same "aspirational, not scoped" status, now with a concrete data model underneath it instead of just a mockup.

**Status, stated plainly so it can't drift**: direction approved → architecture documented → implementation deferred → real evidence accumulated first. Nothing above is a commitment to build on any particular date; it's a commitment that when the time comes, it gets built on this shape, not reinvented from scratch or rushed into existence with fabricated numbers.

### Measuring whether a fix actually worked — the evaluation & ROI layer

A fourth-round addition, proposed by the user on top of everything above: once a `Finding` produces a corrective action, how do you know it actually helped, and was it worth what it cost? Two ideas, kept genuinely separate because they're at different levels of readiness.

**1. The correction-routing decision — real now, no new system needed.** A verified `Finding` should always be routed through the cheapest layer that can fix it, in order: configuration/knowledge (a prompt tweak, an FAQ) → application code → provider/model choice → fine-tuning, only ever as a last resort. This isn't new — it's principles 2 and 6 already adopted above (human review before learning; capability is evidence-gated), made into an explicit checklist. Worth stating plainly: **P2Less has never fine-tuned a model, and nothing in the current architecture needs to yet** — every fix this entire project has shipped has been a prompt instruction, an FAQ, or application code.

**2. Per-dimension before/after evaluation — real direction, genuinely not ready to build, and worth being precise about why.** The idea: don't report "we fixed 31 bugs," report a measured before/after across named dimensions (response integrity, task completion, intent accuracy, grounding, context retention, ...), so the Evidence & Assurance system can show whether quality actually moved and whether the cost to move it was worth it. Right, and it deserves the same "don't manufacture a 97.8%" discipline already governing the rest of this section — arguably more, because a per-dimension score is *more* exposed to fabrication than one aggregate number, since each dimension needs its own real scoring method:

- **Mechanically checkable today, no new methodology required**: response integrity (did the output preserve the exact number/date/name the connector returned — literally what `humanizeReply()`'s existing invariant already governs) and task completion (did a workflow reach a real terminal state). These could be scored from existing logs with no new infrastructure.
- **Needs a real, validated methodology that doesn't exist yet**: grounded-answer accuracy, factual accuracy, context retention. These need either human labeling or a validated LLM-as-judge approach — and an LLM judging an LLM is itself unproven until it's checked against real human judgments. Publishing a percentage here before that validation exists would be exactly the fabrication trap this whole subsystem is designed to prevent.
- **No evaluation set exists to run any of this against.** `scripts/test.ts`'s 73 cases are hand-written pass/fail assertions, not a labeled, representative scenario corpus — a different kind of artifact. Building one from scratch, upfront, would be speculative in exactly the way the rest of this document argues against.

**The connection worth making explicit — this is one system, not two.** The evaluation set shouldn't be authored upfront; it should be *built from real `Finding`/`TestExercise` rows once Evidence & Assurance has produced enough of them*. The 82 feedback reports and 4 test exercises in this doc's own acceptance-bar example aren't just evidence — they're literally the corpus an eval set gets built from. That puts this layer sequenced **after** Evidence & Assurance's own data model exists and has real rows in it, not alongside it as parallel work.

**The cost/ROI half is closer to buildable than the scoring half, and worth noting why**: `AiRequestLog` already logs provider/model/cost/latency per request, and `billing.ts` already has the metered PRICE/COST-line pattern. A "quality gain vs. cost delta → keep/revert/iterate" calculation is largely a query over data already being collected, not new instrumentation — once the quality side of the equation has a real number to put next to it.

**Status, same as above**: direction approved, sequenced explicitly after `TestExercise`/`Finding` exist and hold real data — not scoped, not started.

### Multimodal evaluation — extends this model, doesn't fork it, once those capabilities exist

A fifth-round addition: when audio and video are eventually built, they shouldn't get a separate QA framework — `TestCase` just gains a `modality` field (`text | image | audio | video`), and the same waterfall applies with more stages to check. The one genuinely new idea, worth keeping: **trace a failure to the specific processing stage, not just "AI vs. correct"** — a misheard "forty thousand" transcribed as "fourteen thousand" is a transcription failure, not a reasoning failure, even though the final number is still wrong. This is the same discipline as the loan-balance connector/AI diagram earlier in this doc, just with more stages in the chain (transcription/OCR → extraction → intent → connector → response) to attribute the failure to. Store the original evidence alongside each intermediate stage (transcript, extracted text, entities) where privacy/retention rules allow, so a reviewer can see exactly where a chain broke rather than labeling everything "AI error."

**Worth being precise about how far out this actually is**: image/document analysis (OCR-ish extraction from receipts, PDFs) already exists today, live, on WhatsApp — real, current, testable now if anyone wanted to. Audio and video don't exist at all and aren't currently scoped anywhere on the roadmap (the researched-but-unbuilt Voice/IVR candidate is phone-menu routing and text-to-speech, not audio *understanding* — a different capability). So this section is a design note attached to capabilities that don't exist yet and aren't yet committed to being built, not a near-term plan. Same closing rule as principle 6, restated for modality specifically because it's worth having in exactly these words: **a modality is only "supported" once its complete user journey has been tested, verified, and monitored — not the moment the code can technically process the file type.**

## Phased rollout

**Phase A — the schema and triage dashboard are ✅ SHIPPED 2026-08-23; the pilot recruiting itself has not started.** Extended `SupportTicket` with `source` (internal | tenant | public_report, defaulting "internal"; the existing WhatsApp escalation path now tags itself "tenant") and `qualityCategory` (nullable, the 11-category taxonomy above — deliberately a separate field from the pre-existing general-purpose `category` column, not a collision) plus a `relatedMessageId` soft ref so a reviewer can pin a ticket to the exact message it's about. Built `/admin/quality` — the triage dashboard, tickets grouped by category, same `Card`/`Badge` visual language as the existing tickets workspace, reusing the `tickets.view`/`tickets.manage` permissions rather than adding new RBAC surface for this pilot. The ticket workspace (`/admin/tickets/[id]`) gained a "Quality investigation" panel to set the category and link a message, and `NewTicketModal` gained source/quality-category fields for logging a report an admin received elsewhere. Live-verified end to end (set category → shows on `/admin/quality` grouped correctly, `SupportTicket.source` defaults correctly on legacy rows, message link records against the real conversation) and 73/73 regression suite clean. **Still not started**: recruiting a real pilot group and actually reporting through WhatsApp/widget — the workflow exists, nobody has used it yet.

**Also shipped the same day, on top of Phase A — the Action Decision step.** A verified `qualityCategory` (root cause) doesn't imply a fix layer, so it was a real gap that nothing forced a reviewer to decide *what to actually do about it* rather than reflexively defaulting to "needs a developer." `SupportTicket` gained `actionRequired` (12 values, cheapest-appropriate-layer ordered: `no_action` → `knowledge_update`/`configuration_change`/`prompt_change` → `connector_data_fix`/`ai_model_change`/`operational_procedure` → `user_training`/`documentation_change`/`ux_change`/`monitoring_change` → `code_change`) and a mandatory `actionReason`, set from the same Quality investigation panel, gated on the category already being set. `/admin/quality` now shows a live "Actions" breakdown with a computed `% of decided findings required a code change` — a real answer to "how many of these actually need a developer," never a typed-in number. This is the correction-routing ladder (principle 6) made into an auditable, mandatory step instead of a principle a reviewer is trusted to remember.

Once that pilot group exists, a sample recruiting message, since "try to break it" framing gets better reports than a generic feedback request:

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

## Open questions only the user can answer — RESOLVED 2026-08-24

1. **Review capacity.** Answered: **both, on the user's own timing** — not a one-time choice between internal-only and public. Built as a real admin-controlled toggle (`quality_feedback_invitation_enabled`, `/admin/system-health`, default OFF) rather than baking the decision into a deploy — the reporting mechanism itself already works identically either way (the widget accepts a report from anyone regardless of the flag); the toggle only controls whether the "found a bug? tell us" invitation is publicly DISPLAYED on the landing page. The user flips it on personally whenever they've decided review capacity allows it.
2. **Tenant scope.** Answered: **platform-level only**, confirmed — the P2Less self-tenant/landing-page widget, not every tenant's own deployment. Matches how the invitation banner and its copy were built (landing page only, no per-tenant equivalent).
3. **Data handling.** Answered: **reviewer-only visibility as reports arrive, manual redaction discipline before any wider or client-facing use** — not automated PII-stripping. Explicitly rejected building real-time detection/redaction on intake: imperfect PII-detection risks hiding evidence a real investigation needs (a phone number or account reference in a report can BE the evidence), and there's no real volume yet to justify that engineering cost. Revisit if/when this scales past what manual discipline can carry.

**What shipped from this** (§68, `docs/OPERATIONS-GUIDE-2026-08-23.md`): the Phase B invitation toggle described in answer 1, live-verified end to end. The Evidence & Assurance subsystem (`TestExercise`/`TestCase`/`Finding`/`AssuranceReport`) remains explicitly deferred per this document's own sequencing — it still needs Phase A's pilot to produce real triaged findings first, which resolving these three questions unblocks the START of, not a substitute for.
