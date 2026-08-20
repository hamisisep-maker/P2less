# P2Less — Universal Platform Roadmap

Sequencing for `docs/VISION-UNIVERSAL-ACCESS-PLATFORM-2026-08-19.md` against what's actually built (`docs/SYSTEM-DISCOVERY-2026-08-19.md`, Priorities 1-6 shipped). Nothing in this document is built yet — it's a proposed sequence, not a commitment. Each phase ends with an explicit decision point before the next one starts, same discipline as every priority shipped so far this project.

**Sequencing principle**: schema/foundation before behavior, behavior before new verticals. Multi-branch and the Capability model are both structural (everything downstream depends on them existing), so they come first even though they're less visible than a new feature would be. Net-new product surfaces (social media, marketplace, OCR) come last — they're additive, nothing else in this roadmap depends on them existing first.

---

## Phase 1 — Foundational data model (branch hierarchy + capability + provenance schema) — ✅ SHIPPED 2026-08-19

**Goal**: get the three new structural concepts into the schema as additive tables, without changing any existing behavior yet. Nothing user-facing changes in this phase — it's the substrate the rest of the roadmap builds on.

- `Organization` becomes the real tenant-parent concept; `Region`/`Branch` added under it. Existing single-branch tenants get one implicit "default" branch so nothing breaks — **reuse the existing `Tenant` model as `Organization`**, don't rename/duplicate it. **Implemented as ONE self-referential `Branch` model** (`tenantId`, `parentBranchId?`, `kind: "branch"|"region"|"hq"`) rather than separate `Region`/`Branch` tables — the vision doc's own examples show arbitrary-depth hierarchies, and a region is structurally just a branch with children. `isDefault` marks the auto-backfilled branch every pre-existing tenant got via `scripts/backfill-default-branches.ts` (idempotent, verified — 4/4 tenants backfilled locally, re-run correctly skipped all 4).
- **Deviated from the original plan here after reading the actual code**: `ConnectorAction` already IS the vision doc's "Capability" concept almost field-for-field (connector=source system, method+path=action, paramSchema=input, responseMapping=output, requiredPermission/resourceGrantKey=authorization, requiresStepUp/requiresConfirm=confirmation). Rather than create a duplicate parallel `Capability` table, **extended `ConnectorAction` in place** with `riskLevel` (low/medium/high), `approvalRequired` (a DIFFERENT human must approve — distinct from `requiresConfirm`, which is the actor confirming their own action), and `failureBehavior` (free-form note, not yet consulted). Lower risk, no duplicate concept to keep in sync, matches this project's own "don't rebuild unnecessarily" discipline.
- Provenance: `FactSource` type shipped at `src/lib/provenance.ts` (kind: known/calculated/configured/generated/unknown + system/recordId/retrievedAt) — a plain TS type, not a DB table (provenance travels with a reply, it isn't persisted state). Not wired into `ai.ts`/`conversation.ts` yet — that's Phase 4.
- All three additions are additive/nullable/defaulted — confirmed via `prisma db push` with **no data-loss warning** (same safe shape as the `Notification` rename in Priority 6, not the `@unique`-on-populated-table pattern that required the two-commit dance in Priorities 4/5).

**Risk**: this phase WILL add `@unique`/relation constraints to tables with existing production rows (same class of migration that hit Priorities 4/5/6 three times) — plan the two-commit `--accept-data-loss`-then-revert dance proactively, not as a surprise.

**Decision point before Phase 2**: does every existing tenant get exactly one auto-created "Main" branch (simplest, recommended), or does branch-assignment need a manual admin step at rollout?

## Phase 2 — Wire branch-scoping into what already exists — ✅ SHIPPED 2026-08-19

**Goal**: branch becomes a real dimension of permissions, routing, and config — still invisible to any tenant with only one branch (backward-compatible by construction).

- `WhatsAppNumber.branchId` (nullable, `SetNull` on branch delete) — a number can now be the front door for a specific branch. `resolveNumberBranch()` (`src/lib/branches.ts`) falls back to the tenant's `isDefault` branch when unset (every number today), so routing behavior is unchanged for every existing tenant. Wired into `conversation.ts::handleInbound()` — resolved once per conversation and cached on `ConvContext.branchId` (persisted via the existing `emit()` → `conversation.context` write path), not re-queried every message. **Deliberately did NOT build the "which branch?" clarifying-turn flow yet** — with no real multi-branch tenant to design/test it against, a speculative conversational disambiguation flow risks becoming exactly the kind of untested abstraction the original decision point below warns about. Revisit once a central-number-multi-branch tenant actually exists.
- `UserRole.branchScope` (nullable JSON array of Branch ids, mirrors `User.adminScope`'s exact null-means-unrestricted convention) — lives on the role ASSIGNMENT not the Role definition, since the same Role can be assigned to different users at different branches. `hasBranchAccess()` helper (`src/lib/branches.ts`) exists and is ready to call, but **is NOT yet wired into any dashboard authorization check** — same reasoning as above, deferred pending a real pilot tenant rather than guessed at.
- **Corrected after reading the actual schema** (same discipline as Phase 1's `Capability`-vs-`ConnectorAction` correction): did NOT add `branchId` to `Incident` or `Notification`. `Incident` is fully platform-scoped (P2Less's own operational health — AI provider failures, job failures — never had a `tenantId` at all, so branch attribution doesn't fit the model). `Notification` has no branch-aware event producer yet — adding an always-null column now would be exactly the kind of dead/unwritten field this project's own audit flagged and removed (`Contact.pinHash`, `User.phone`) in Priority 6. Revisit both once a real branch-scoped event exists to attribute.
- **Deferred**: the generic `platform → org → region → branch → user` config cascade. No concrete per-branch setting exists yet to cascade over (the vision doc's own example, branch-specific business hours, isn't built) — building a generic cascade helper with nothing real to resolve would be speculative. Build this when the first real per-branch setting is needed.

**Decision point before Phase 3 (unchanged, still open)**: which pilot tenant (if any) actually needs multiple branches first? Both deferred items above (branch-disambiguation conversation flow, dashboard-level `hasBranchAccess()` enforcement) are blocked on this, not on any remaining technical work.

## Phase 3 — Capability-ize existing connector actions — ✅ SHIPPED 2026-08-19

**Goal**: retrofit today's connector actions to point at real capability descriptors instead of loose per-action flags, and make the "can AI do this → authorized → confirm → execute" gate an explicit, reusable, testable function instead of logic embedded inline in `dispatchAction`/`runAction`.

- `evaluateCapabilityGate()` (`src/lib/capability-gate.ts`, new) — a deliberately PURE function (no DB calls, no side effects) covering the permission → resource (IDOR) → step-up → confirm ladder, replacing what used to be four separate inline `if` checks in `conversation.ts::runAction()`. The caller resolves async facts first (e.g. `hasVerifiedSession()`) and passes plain booleans/arrays in, which is what makes it trivially unit-testable — proved with an 11-case direct behavioral test covering every branch (permission deny, resource deny, step-up required/satisfied, confirm required/satisfied, step-up-over-confirm priority, approval classification) before this shipped.
- `riskLevel` backfilled meaningfully for all 20 existing `ConnectorAction` rows via the idempotent `scripts/backfill-capability-risk-levels.ts` (derived from `requiresStepUp`→high, `requiresConfirm`/write→medium, else low) — 9/20 actions updated from the flat "low" default (e.g. `GET_STUDENT_RESULTS`/`GET_MY_PAYSLIP`→high, `BOOK_APPOINTMENT`/`CANCEL_MEETING`/etc→medium), re-run confirmed idempotent.
- `approvalRequired` is genuinely **classified** by the gate (`needsApproval` on the decision) but **deliberately NOT enforced** — gating execution behind it without a resume mechanism would strand any action an admin marks `approvalRequired` in a permanent dead end (submitted, never resolves) worse than not enforcing it at all. No `ConnectorAction` has `approvalRequired:true` today (no admin UI sets it), so this is genuinely inert in production, not a live gap. The full "queue via Notification Engine → admin approves/rejects on a dashboard → resume execution" pipeline is real, non-trivial work (needs a `PendingApproval`-style model) — deferred as its own future slice, not built speculatively here.
- **Caught a real scare via live verification, resolved as a false alarm**: the refactored gate initially APPEARED to skip the confirm step in a live test (booking went straight to execute). Isolated via `git stash` A/B testing against the pre-refactor code with the identical DB state, then a debug-logged clean server restart — traced to Next.js/Turbopack's known unreliable hot-reload in this codebase (already documented from an earlier priority: "a stale `next dev` process still running the pre-edit module in memory"), not a real code defect. The gate's actual behavior, confirmed via debug-logged live requests, is correct: `BOOK_APPOINTMENT` (`requiresConfirm:true`) → `decision.step:"confirm"` on first request, → `decision.step:"execute"` once `alreadyConfirmed:true`. Lesson reinforced: after any hot-reload-sensitive change in this project, a full server stop/restart is mandatory before trusting a "regression," not just a file save.

## Phase 4 — Provenance-tagged responses + conflict resolution

**Goal**: every fact P2Less states carries a Known/Calculated/Configured/Generated/Unknown tag, and cross-system field conflicts resolve via configured source-priority instead of silently picking one. **✅ SHIPPED 2026-08-19**

- **Deliberately did NOT touch the AI prompt text in `ai.ts`.** Before starting this phase, actually read `humanizeReply()`/`smallTalk()`'s system prompts — they already implement the Known/Configured/Generated distinction in mature, carefully-tuned natural language (explicit "WHAT YOU ALREADY KNOW (authorized...)" / "APPROVED ORGANIZATION ANSWERS (official...)" sections, an explicit "NEVER invent... say plainly you don't have that on hand" rule), refined across many prior bug fixes this project. Reformatting that into symbolic `[KNOWN]`/`[GENERATED]` tags risked regressing a proven system for no clear behavioral gain — a model generally follows well-written natural-language framing at least as reliably as an inline tag it has to interpret. Chose NOT to touch it.
- Instead, formalized the TYPE underneath the existing text: new `buildKnownFactEntries()` in `conversation.ts` returns `{ text, source: FactSource }[]` (real `FactSource` tags from Phase 1's `provenance.ts` — `known`/`system:"contact_record"` for identity+grants, `known`/`system:"platform_order"` for `lastOrder`, `known`/`system:"platform_action"` for `lastAction`). `buildKnownFacts()` is now a thin wrapper (`entries.map(e => e.text).join("\n")`) — **verified byte-identical to the pre-Phase-4 prompt text by construction** (every template literal copied character-for-character, confirmed via diff review) and live-tested (a real "what is my child's name" question still answers correctly from the same known-facts block). Zero risk to the tuned AI behavior; the provenance is now real and attachable to a future consumer (an admin "why did the bot say this" view, an audit log) that doesn't exist yet.
- `resolveFieldConflict()` (`src/lib/field-conflict.ts`, new) — pure, tested (7 cases: no candidates, unanimous agreement with 1 or many sources, conflict with no priority config, priority resolves correctly, priority source missing from candidates → tied/unresolved). **Honest status, same as Phase 3's `approvalRequired`**: no live caller exists yet — every tenant today has exactly one connector per external system (confirmed in `docs/SYSTEM-DISCOVERY-2026-08-19.md`), so there is no real two-systems-disagree scenario to resolve. Will wire in the moment a tenant actually connects two overlapping systems; building the caller before that exists would be speculative machinery with nothing real to exercise it. The "escalate to a human review queue via the Support/Ticket model" integration from the original plan is deferred for the same reason.

## Phase 5 — Generalized workflow engine — 🟡 CORE FLOWS DONE 2026-08-20 (9 of 9 quantified states), 4 bespoke-candidate flows still NOT started

**Goal**: today's booking/order flows are each a hand-built `awaiting_*` state machine in `conversation.ts`. Generalize the pattern (trigger→check→ask→wait→validate→execute→notify→record) into a reusable workflow definition, keeping the existing flows as the first migrated examples rather than a parallel system.

- Full sub-roadmap written after actually reading all 12 `awaiting_*` handlers: **`docs/PHASE5-WORKFLOW-ENGINE-SUBROADMAP-2026-08-19.md`**. Built the genuine shared-decision primitive (`evaluateWorkflowAsk()` in `src/lib/workflow-engine.ts`, 7-case tested against the real observed behavior of `awaiting_confirm`/`awaiting_param`) but **deliberately did NOT migrate any existing flow** — two concrete blockers found while investigating, not assumed: (1) real regression risk to code hardened through many specific prior live bugs, (2) the local dev/test harness can't currently prove parity (every `Connector.baseUrl` is hardcoded to port 3000, this preview harness always runs on 3001 — confirmed as the root cause of 24/73 E2E test failures, unrelated to any code change). See the sub-roadmap for the recommended pilot flow, migration order, and what needs to be true before migration starts.

## Phase 6 — Developer platform: OpenAPI-driven connector drafting — ✅ SHIPPED 2026-08-20

**Goal**: a developer pastes/uploads an OpenAPI spec → P2Less proposes a draft capability set (endpoints→actions, schemas→input/output) → human validates before it goes live. Builds directly on the existing `ConnectorAction` model (Phase 1 extended it in place rather than a separate `Capability` table — see that phase's entry); no new concept, just an assisted authoring tool for it.

- **Investigated the existing manual Connector Builder first** (`/dashboard/connectors/new`) — confirmed it can only create ONE `Connector` with exactly ONE `ConnectorAction` per form submission, with a naive param-schema derivation that special-cases the literal string `"studentId"`. Every OTHER action on an existing connector (10 for the Riverside School System, for example) was only ever created via `prisma/seed.ts`, never through any UI. This is the real gap Phase 6 closes: adding several capabilities from one external system previously required either resubmitting the form N times (wrongly creating N separate `Connector` rows for one real system) or direct DB/seed access.
- `parseOpenApiSpec()` (`src/lib/openapi-import.ts`, new) — a pure function, no DB or network access, parsing pasted OpenAPI 3.x (and basic Swagger 2.0) JSON into a draft capability list: per path+method, derives a suggested key (from `operationId` if present, else method+path), collects path/query parameters and top-level JSON request-body properties into the same `ParamSpec` shape the engine already uses, and defaults `riskLevel`/`requiresConfirm` the same way `backfill-capability-risk-levels.ts` (Phase 3) does (GET→low/no-confirm, everything else→medium/confirm). Deliberately does NOT guess `resourceGrantKey`/`resourceParam` (which grant type authorizes a request) — the existing manual form only ever special-cased one hardcoded field name, and guessing wrong here would silently create an under-authorized capability; left for the human to set during review. Deliberately **paste-only, never a URL the server fetches** — accepting and fetching an admin-supplied URL server-side is a textbook SSRF vector. 10 unit tests (error cases: invalid JSON, missing `paths`, missing version field; success case: operationId-derived key, path-derived fallback key, path+query+body param extraction, correct risk defaults, empty paramSchema for no-param endpoints) before wiring into any UI.
- `/dashboard/connectors/import` (new page + client form) — two-step: paste spec → parsed entirely in the browser (no round-trip, since the parser has no server-only dependency) → an editable review table (per-draft-action checkbox to include/exclude, editable key/name/required-permission/risk-level/confirm/step-up) → submit creates ONE real `Connector` + only the CHECKED `ConnectorAction` rows via `createConnectorFromDraftAction` (new, `src/lib/actions.ts`), which reuses the exact same auth-config/`encryptJSON` path as the original manual form — no separate "imported connector" runtime code path. An action a human unchecks is never created at all, not created-then-disabled.
- **Live-verified end-to-end**, not just unit tests: logged in as a real tenant user, pasted a real 2-endpoint spec (GET with a path param, POST with a request body), confirmed the review step correctly pre-filled the connector name/description/base URL and both draft capabilities with correct keys/params, submitted, and confirmed a real `Connector` + 2 `ConnectorAction` rows were created and correctly listed on `/dashboard/connectors` — then cleaned up the test data.
- **Full regression suite run clean at 73/73** on a freshly reseeded database — the first fully green run this session, confirming Phase 6 (and every fix made earlier the same day) introduced zero regressions.

## Phase 7 (Future-strategic, deliberately unscoped) — new verticals

Social-media connectors + content pipeline, document/OCR ingestion beyond today's PDF-generation-only `Document` model, research/plagiarism tooling — still deliberately unscoped. Each is a large, mostly-independent product surface. Don't scope these in detail until a real need exists.

### Connector marketplace — ✅ SHIPPED 2026-08-20 (platform-curated only)

Confirmed scope with the user first: the vision doc's open-developer-publishing marketplace assumes an ecosystem of OTHER developers, which doesn't exist yet (P2Less has one operator today) — building a submission/review/trust workflow for zero real publishers would be pure speculative machinery. Went with the recommended narrower scope instead: a **platform-curated catalog**, reusing Phase 6's review-then-create flow end-to-end rather than inventing a parallel install path.

- `ConnectorTemplate` (new model, platform-wide, no `tenantId`) — `key`/`name`/`description`/`category`/`baseUrlHint`/`authType`/`actions` (the same `DraftAction[]` shape Phase 6's OpenAPI parser already produces, so the exact same review UI renders either source unchanged).
- `scripts/sync-connector-templates.ts` (new, idempotent) — populates the catalog by reading each source connector's REAL, currently-live `ConnectorAction` rows straight from the database and copying them in, rather than hand-transcribing (which risks silent drift from what the connector actually does). Seeded 4 templates from the platform's own real connectors: School Management System (9 capabilities), Payroll & HR System (7), Hospital Patient Management (1 — honestly reflects that only one action exists for that connector today, not padded out), Retail Order Tracking (1). `IDENTIFY` excluded from every template — an internal onboarding capability, not a marketplace-relevant one.
- **Refactored Phase 6's review-table UI into a shared `ConnectorDraftReviewForm` component** (`src/app/dashboard/connectors/connector-draft-review-form.tsx`) before adding the marketplace, rather than copy-pasting ~150 lines — both `/dashboard/connectors/import` (parse a pasted spec) and the new `/dashboard/connectors/marketplace/[key]` (load a stored template) now feed the identical review-then-create step, submitting through the same `createConnectorFromDraftAction` from Phase 6 unchanged.
- `/dashboard/connectors/marketplace` (new) — browse all active templates with real capability counts and names. `/dashboard/connectors/marketplace/[key]` (new) — install: template's `baseUrlHint` and actions pre-fill the SAME editable review form Phase 6 uses (an install is structurally identical to an OpenAPI import, just pre-seeded from a template instead of a freshly-parsed spec), admin fills in their OWN real base URL/credentials, reviews/edits every capability, submits.
- **Live-verified end-to-end**: real tenant login, installed "Hospital Patient Management" onto Riverside Academy (a SCHOOL tenant installing a HOSPITAL template — deliberately cross-category to prove the flow doesn't assume anything about the installing tenant's own type), confirmed correct pre-fill, submitted, confirmed a real `Connector` + the real `GET_NEXT_APPOINTMENT` capability were created and correctly listed, cleaned up.
- Full regression suite run clean at 73/73 on a freshly reseeded database.

---

## Phase 8 (Future-strategic, deliberately unscoped) — Multi-Channel Engine

User-provided vision, 2026-08-20, documented here verbatim as the architecture sketch, not yet scoped into phases or started:

```
CHANNEL

                         P2Less
                           │
              ┌────────────┴────────────┐
              │                         │
           INBOUND                   OUTBOUND
              │                         │
       Who contacted us?          Who do we reach?
              │                         │
              ▼                         ▼
      Customer / Student          Target Audience
              │                         │
              └────────────┬────────────┘
                           │
                    CHANNEL LAYER
                           │
       ┌──────────┬────────┼────────┬──────────┐
       ▼          ▼        ▼        ▼          ▼
   WhatsApp   Facebook  Instagram  TikTok     SMS
       │          │        │        │          │
       └──────────┴────────┼────────┴──────────┘
                           │
                  CHANNEL-SPECIFIC RULES
                           │
                           ▼
                Permissions / Policies
                Templates / Consent
                Rate Limits / Restrictions
                           │
                           ▼
                     P2Less Engine
   │
   ├── Inbound
   │     ├── Receive messages
   │     ├── Receive media
   │     └── Create/update conversation
   │
   └── Outbound
         ├── Transactional
         ├── Marketing
         ├── Notifications
         └── Follow-ups
                │
                ▼
        POLICY / PERMISSION ENGINE
                │
        ┌───────┴────────┐
        │                │
      Allowed          Not Allowed
        │                │
        ▼                ▼
      SEND             BLOCK
```

**What this reuses vs. what's genuinely new**, read against what's actually built today (not assumed):

- **Inbound / receive messages, media, create-or-update conversation** — this is `handleInbound()` in `conversation.ts`, already real and already channel-agnostic in its internal design (WhatsApp and the web-chat demo already share one pipeline). Adding a new inbound channel means a new thin webhook adapter that resolves to a tenant and calls the same pipeline — the same shape the WhatsApp webhook already is. Real work, but a known, proven pattern, not a new architecture.
- **Channel layer beyond WhatsApp** — Facebook, Instagram, TikTok, SMS integrations: **none exist today**. SMS specifically is confirmed mocked (a literal `console.log`, per the system discovery audit), not partially built. Each of these is its own real integration project (different APIs, different auth, different message-format constraints), not a config toggle.
- **Outbound / Transactional** — the closest existing analog is real: every reply the assistant sends back in response to something the user asked (confirmations, answers, documents) already goes out today via `transport.ts`. That's "transactional" in spirit already, just not labeled as a distinct category.
- **Outbound / Notifications** — partially real: Priority 6 built a genuine notification engine (email, to *platform staff and tenant admins* for incidents/tickets/billing events). That is NOT the same thing as this diagram's "notifications" arrow, which reads as reaching **end customers/students** proactively (e.g. "your appointment is tomorrow") — that specific capability, an admin-triggered or system-triggered proactive outbound message to an end user on WhatsApp/SMS/etc. outside of them messaging first, **does not exist today**. P2Less is 100% inbound-triggered on the customer side right now — nothing reaches a customer unless they messaged first (or, for orders/tickets, unless they're already mid-flow).
- **Outbound / Marketing** and **Outbound / Follow-ups** — **do not exist in any form today.** No broadcast/campaign tool, no scheduled drip sequence, no audience/segment concept for end users at all (the `Contact` model has no "marketing consent" or "campaign membership" field). This is genuinely new product surface, not an extension of something partially built.
- **Channel-specific rules (permissions/policies/templates/consent/rate limits)** and the **Policy/Permission engine (Allowed → Send / Not Allowed → Block)** — conceptually this generalizes a pattern P2Less already has in a narrower form: `evaluateCapabilityGate()` already gates whether an *action* is allowed for a given actor. This diagram asks for the same shape of gate, but for a different dimension entirely — whether a specific *outbound message, to this specific person, on this specific channel, of this specific type (marketing vs transactional), right now* is allowed. That's a real, non-trivial new engine, not a reuse of the existing one, even though the *shape* (a pure decision function gating an action) is the same proven pattern used everywhere else in this codebase.

**A real external constraint worth being honest about now, not discovering it mid-build**: WhatsApp's own Cloud API already enforces this exact distinction at the platform level — free-form replies are only allowed within a 24-hour window after the customer's last message; anything outside that window (including any marketing-style message) requires a pre-approved message *template* and, for genuine marketing sends, explicit opt-in tracking. So the "Policy/Permission engine" in this diagram isn't just an internal nice-to-have — for WhatsApp specifically, a real implementation is *required* to stay compliant with Meta's own platform rules, not just a P2Less design choice. The same kind of constraint (opt-in, quiet hours, carrier filtering) exists for SMS too, differently per channel — this is exactly why "channel-specific rules" is drawn as its own layer in the diagram, and it's correct to keep it that way.

**Sequencing note**: this depends on nothing else in this roadmap (additive, like Phase 7), but it's meaningfully larger than Phase 7's scope — Phase 7 added one new capability *within* the existing single-channel, inbound-only model; this adds a second axis (outbound) and multiple new channels at once. Recommend treating "outbound engine + policy gate" and "each new channel integration" as separate, independently-scoped pieces of work when this is picked up, not one monolithic build — and starting with outbound *notifications to existing customers* (the smallest, least platform-risk piece, and the most directly requested by real prospects like the college example) before marketing/broadcast, which carries the most compliance risk and the least proven demand so far.

### Phase 8b (Future-strategic, deliberately unscoped) — Public Social Agent ("Grok-on-X" mode)

User request, 2026-08-20: distinguish this from Phase 8's outbound-to-known-contacts model — some clients will want P2Less to **initiate conversations** (Phase 8 covers that) and separately, some will want it to **monitor and reply to public posts/comments/mentions** on Facebook, Instagram, TikTok, and X/Twitter, the way Grok engages publicly on X. This is a **third, distinct product mode**, not a channel added to Phase 8 — the blast radius, APIs, and compliance model are all different enough that conflating it with Phase 8 would blur real risk differences:

| | Mode 1 — Access & Automation (built) | Mode 2 — Outbound CRM (Phase 8) | Mode 3 — Public Social Agent (this section) |
|---|---|---|---|
| Who starts it | The customer | The organization, to a known contact | Nobody — it's monitoring public posts/comments/mentions |
| Visibility of a mistake | One person | One person | **Everyone** — public, screenshotable |
| Primary buyer | Ops/admin | Ops/admin or marketing | Marketing/brand/comms |

**Per-channel API and compliance reality, as of what's publicly documented today (not legal advice — verify against each platform's current terms before any client goes live):**

- **Meta (Facebook/Instagram) comments & mentions** — real, documented Graph API access, comparable build difficulty to what's already shipped for WhatsApp/Messenger. Meta's Platform Terms require disclosing automated responses where relevant, and standard spam/abuse enforcement applies.
- **TikTok** — comment/reply API access is restricted to approved business partners, not open by default; expect a longer access-approval lead time than Meta. TikTok's Community Guidelines prohibit spammy/bot-like automated engagement without clear disclosure that it's automated.
- **X/Twitter** — X's **Automation Rules** require automated accounts/replies to be clearly labeled as such and require Developer Agreement compliance. Meaningful reply volume requires a **paid API tier** (the free tier is too limited for real use) — unlike Grok, which has privileged first-party platform access a third party does not get by default. X actively enforces against inauthentic/spam-like coordinated engagement.
- **The one rule constant across all three**: **disclose automation.** Every platform either requires this explicitly or enforces against undisclosed bots as a trust/authenticity violation — this isn't a P2Less design preference, it's a policy requirement everywhere this mode would run.

**What this needs that doesn't exist today**: a social-listening/ingestion layer (poll or subscribe to mentions/comments/DMs per platform), a much stronger brand-voice/tone-safety guardrail than today's grounded-but-narrow assistant prompts (a wrong PUBLIC reply is a brand incident, not a support ticket), and — strongly recommended for at least the initial rollout — a human-approval step before a reply posts publicly, reusing the same risk-tiered confirm/approval pattern already established elsewhere in this codebase (`evaluateCapabilityGate`'s `approvalRequired` concept), just applied to "post publicly" as a high-risk action rather than a data-mutating one.

**Recommended sequencing relative to Phase 8**: build after Phase 8's outbound-notifications slice (lowest risk, most-requested), and specifically start with **assisted mode** (AI drafts, a human approves and posts) rather than fully autonomous public posting — both because it's the safer engineering default and because it's the only version of this that's honestly sellable before there's a real track record to point to.

### Phase 8a (scoped, ready to build) — Mode 1 channel expansion: Facebook Messenger + Instagram DMs

User request, 2026-08-20: extend the EXISTING access-and-automation model (Mode 1 — the customer messages first, gets a real grounded answer from their own systems) to Facebook Messenger and Instagram, rather than building a new mode. **This is genuinely the lowest-risk, fastest-to-ship item on this whole roadmap** — it reuses the existing channel-agnostic `handleInbound()` pipeline unchanged, and because it's reactive (the customer initiates), it does NOT hit the marketing-template/opt-in restrictions that apply to Phase 8's outbound mode. Numbered "8a" for filing purposes only — it does not need to wait for Phase 8 or 8b and can be built first.

**What it reuses, unchanged**: the entire conversation engine, connector engine, OTP/permission gates, grounded-AI/never-invents-facts behavior, and the existing product-photo-in-chat feature (`Product.imageUrl` + `storeProductImage()`) — a photo sent in reply to "what does this look like?" on Messenger uses the exact same data and mechanism already proven on WhatsApp. No new capability there, just a new delivery channel.

**What's genuinely new — the scoping**:
1. **New webhook adapter** (`src/app/api/channels/messenger/webhook/route.ts`, mirroring the existing WhatsApp webhook's shape): verifies Meta's webhook signature, resolves the inbound Page ID to a tenant (same "number → tenant" pattern as WhatsApp, just "Page ID → tenant" instead), then calls the same `handleInbound()`.
2. **New registry model or field**, mirroring `WhatsAppNumber`: a `FacebookPage`/`SocialChannel` row per tenant storing the Page ID, a per-page access token (encrypted at rest, same `encryptJSON` pattern already used for connector credentials and WhatsApp tokens), and connection status.
3. **New outbound delivery function** in `transport.ts` alongside the existing `sendWhatsAppText()`/WhatsApp image sender: Messenger's Send API for text and image attachments — different request shape than WhatsApp's Graph API call, same underlying Meta infrastructure and same App/credentials already in place.
4. **Page connection flow**: an org connects their own Facebook Page (OAuth-style page-linking through the same Meta App, granting `pages_messaging` permission) — this is a smaller, better-documented version of the Embedded Signup work already scoped for WhatsApp, not a new pattern to invent.
5. **Instagram is the same build, not a second build**: Instagram DMs run through the same Meta Graph API family (Instagram Messaging API) once a Page's connected Instagram Business account is linked — steps 1-4 above extend to Instagram with the same webhook adapter (routing on Instagram-scoped IDs) and the same Send API family, not a separate integration project.

**Explicitly NOT in scope for this phase**: the bot only ever *replies* in a conversation here — it does not publish new posts to a Page's public feed/timeline. That's a different capability, scoped separately as Phase 8c below.

**TikTok — explicitly deferred, not part of this phase**: unlike Messenger/Instagram, TikTok's private-messaging API for businesses is newer, more restricted, and largely tied to TikTok's ad products rather than an open "reply to any DM" API — it needs its own scoping and a longer platform-access lead time, closer in difficulty to Phase 8b's restricted-access problem than to this phase's Meta-family reuse. Revisit separately when there's real client demand specifically for TikTok.

### Phase 8c (scoped, ready to build) — Auto-publish new products to Facebook Page + Instagram

User request, 2026-08-20, follow-up to Phase 8a: distinguish *replying* (Phase 8a) from *originating new public content* — specifically, when a product is uploaded via the existing Products dashboard, automatically publish it (photo + name) to the org's own connected Facebook Page and Instagram Business account, with **zero ongoing human login required** after one initial setup step. Confirmed this is genuinely low platform-ban risk, distinct from the earlier Phase 8b public-reply risk discussion — publishing to an account you already own/administer is exactly what the Pages/Instagram Content Publishing APIs are for (the same thing Meta Business Suite, Buffer, and Hootsuite already do for thousands of businesses), not "reaching out" to anyone. The real remaining risk is **content accuracy/staleness**, not policy — a published post is a snapshot; if a product's price or stock changes afterward, the post silently goes stale while still public.

**The automation model, confirmed end-to-end**:
- **One-time human step, per tenant, ever**: the org owner authorizes P2Less once (OAuth-style Page/Instagram Business account linking, granting `pages_manage_posts` + Instagram content-publish permission) — the same one-time connection flow already scoped for Phase 8a's Messenger/Instagram DMs, not a separate flow to build.
- **Every post after that is fully automatic**: no app login, no button click, no human step. Mechanism: Instagram's two-step Content Publishing API (create a media container with an image URL + caption, then publish it) and Facebook's Pages feed-publish API — both reuse P2Less's *existing* public image-hosting (`/d/[token]`, the same mechanism already serving WhatsApp product photos), so no new image infrastructure is needed.
- **Known platform limit, not a practical concern**: Instagram caps API-published posts at roughly 25–50 per account per 24 hours — irrelevant for "post when a product is added" cadence, only relevant at high-volume automated-posting scale far beyond a product catalog.

**What must be built, honestly, alongside the happy path — not an afterthought**: **access-token health monitoring**. A Page/Instagram access token can be silently revoked (org changes their Facebook password, removes the app's access, etc.) — without active monitoring, posting would just quietly stop working with nobody noticing, which directly defeats the "no human ever needs to log back in and check" goal this feature exists for. This is the same class of gap the system discovery audit already flagged for WhatsApp numbers (`checkWhatsAppHealth()` only checks recent message activity, never a live token-validity probe) — build real monitoring for this channel from day one rather than repeating that gap. Concretely: a periodic health-check job (same shape as the existing `integration_health_sweep`/`db_health_sweep` background jobs) that probes token validity and opens a real incident/notification (reusing the Priority 6 notification engine) the moment a token goes bad, not after a client notices their products silently stopped appearing.

**Also requires**: the same Meta App Review (Advanced Access) for `pages_manage_posts`/Instagram publish permissions as Phase 8a, before this works for tenants other than the app's own test Page — not a new review, the same one.

**Explicitly NOT in scope**: editing/deleting a post automatically when stock hits zero, or any other post-lifecycle management beyond initial publish — a real, named follow-up idea, not built or fully scoped yet. Flag it when this phase is picked up, decide then whether it's in the first version or a fast-follow.

### Phase 8d (scoped) — Telegram + Email as additional Mode 1 channels

User request, 2026-08-20: add these as future channels alongside Facebook/Instagram, since they were previously only briefly noted as candidates.

- **Telegram** — genuinely the easiest channel to add after Messenger/Instagram: Telegram's Bot API is open, well-documented, requires no App Review or business-verification gate at all (a bot token is issued instantly via Telegram's own `@BotFather`). Same shape of work as Phase 8a: a new webhook adapter (Telegram's bot webhook → resolve which bot/tenant → `handleInbound()`), a new registry model or field for the bot token (encrypted at rest, same pattern as everywhere else), and a new send-message function in `transport.ts` for Telegram's Bot API. No token-health-monitoring gap here in the same way as Meta — Telegram bot tokens don't expire or get silently revoked by user action the way OAuth-based Page tokens can, only if the org explicitly revokes the bot via BotFather.
- **Email** — universal reach, zero platform-ban risk, but a different interaction shape than the chat channels (no "typing," slower expected reply time, and inbound parsing is messier — need to strip quoted reply chains/signatures before feeding text into `handleInbound()`, which none of the current channels need to do). Needs an inbound email-receiving mechanism (a provider webhook, e.g. the same Resend integration already wired for outbound notifications may also support inbound parsing, or a dedicated inbound-email provider) plus an outbound send path (Resend, already integrated for Priority 6's notification engine — reusable here, not a new provider integration). Best suited as a fallback/lowest-priority channel — real value for organizations whose customers genuinely prefer email, but not the primary channel to build next given WhatsApp/Messenger/Instagram/Telegram all offer richer, faster interaction shapes already proven in this codebase.

**Recommended build order across 8a/8c/8d**: Messenger+Instagram DMs (8a) and Facebook+Instagram auto-publish (8c) share the same one-time Page-connection flow — genuinely efficient to scope and build together in one pass rather than sequentially. Telegram (8d) is a clean, independent add-on afterward with no shared dependency. Email (8d) last, given its lower interaction fit relative to everything else on this list.

### Phase 8e — Website content ingestion (scoped, not started) + embeddable chat widget (✅ SHIPPED 2026-08-20)

User request, 2026-08-20: explored what it would take to embed P2Less on an existing website ("drop a script tag") and have it already know the site's content, without a human re-typing everything into the FAQ editor. Landed on an important distinction, kept as two separate features that combine rather than one feature: the **widget** is only a new *channel* (a place people can chat); it does not, by itself, teach P2Less anything — it reads the exact same `Tenant.faqs`/connectors/products every other channel already reads from. Getting P2Less to actually *learn* from a website's own content is the separate **crawler/ingestion** feature. Neither is built today.

**1. Website content ingestion (build first)** — a backend/dashboard feature, independent of the widget, valuable immediately on every existing channel (WhatsApp included), not gated on the widget shipping:
- Input: a URL. Fetch same-domain pages only, respect `robots.txt`, capped crawl depth — same SSRF-conscious discipline already established for the OpenAPI-import feature, which deliberately never lets the server fetch an arbitrary admin-supplied URL unboundedly.
- Strip navigation/ads/boilerplate down to real page content, then have the AI extract candidate Q&A pairs into the exact same shape as the existing `Tenant.faqs`.
- **Never auto-publish** — present the extracted Q&A list as an editable draft for a human to review, edit, and approve before anything goes live, reusing the same reviewable-draft pattern already proven for OpenAPI import and the connector marketplace (Phases 6/7). An automated parser reading untrusted external content can get things wrong; a wrong "official" organization answer going out live is a real trust problem, not just a bug — the review step is non-negotiable, not a nice-to-have.
- Keep re-scanning manual/on-demand ("re-scan our website" button) rather than a silent background re-crawl job, at least for the first version — avoids live FAQs changing without a human ever looking again.

### Phase 8e — crawler implementation detail (scoped 2026-08-21, ready to build)

Concrete build plan, following the widget's own precedent of scoping to implementation depth before writing code, and reusing existing patterns wherever possible.

**1. Core module — `src/lib/website-crawl.ts`**:
- `crawlSite(startUrl, opts)`: fetches `robots.txt` first and honors `Disallow` rules, then BFS-crawls same-domain pages only, capped at **10 pages** and **depth 2** from the start URL, with a per-fetch timeout and a max response size (bounds cost and prevents a hung/huge page stalling the whole scan). Only follows `<a href>` links on the same registrable domain — never off-site links, ads, or tracking pixels.
- `extractPageText(html)`: strips `<script>/<style>/<nav>/<footer>/<header>` and normalizes whitespace down to real body content — a simple heuristic for v1, not a full readability engine; good enough since the AI extraction step downstream is tolerant of some boilerplate leaking through.
- **Real SSRF protection, built in from the start** — this is genuinely new server-side URL fetching of admin-supplied input, so it gets real protection, not an afterthought:
  - Only `http`/`https` schemes accepted.
  - Resolve the hostname and reject private/reserved/loopback IP ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` — the cloud-metadata range — `::1`, etc.) before every fetch, including after following a redirect (a redirect from an allowed URL to an internal one is the classic bypass — re-validate the final resolved IP, don't just check the original URL once).
  - **Related, pre-existing gap found while scoping this, worth naming honestly**: `connector-engine.ts` already does admin-configured server-side URL fetching (for tenant connectors) with **no equivalent IP-range protection today**. Lower urgency there since connector URLs are set by a tenant's own trusted admin (not an anonymous end user) — same threat model this crawler inherits — but it's a real, separately-fixable gap, not something this feature needs to fix, just flagging it rather than silently ignoring it now that it's been noticed.

**2. AI extraction — new function, not a pure function like `parseOpenApiSpec()`** (this one genuinely needs a real AI call, unlike that deterministic parser): `extractFaqDraft(pages: {url, text}[], orgName): Promise<{q, a}[]>` in `src/lib/ai.ts`. Constrained prompt: extract candidate Q&A pairs a prospective visitor might actually ask, grounded ONLY in the supplied page text, explicit instruction not to invent facts not present in it — same "never invent" discipline as `smallTalk()`'s own system prompt. Total combined page text capped (e.g. ~15,000 characters across all pages) to bound prompt size/cost regardless of site size.

**3. Dashboard integration — extend the EXISTING `/dashboard/faqs` page, not a new page**: since the output is the exact same `{q, a}[]` shape the FAQ editor already manages, and the "human reviews before publish" step is naturally just "edit this list before saving" — the SAME `saveFaqsAction` already used today. Add a "Import from your website" section: a URL input + "Scan this site" button (a new Server Action, `crawlWebsiteAction`, calling `crawlSite()` + `extractFaqDraft()` and returning the draft array to the client — synchronous with a loading state via `useActionState`'s `pending`, same pattern as every other form action in this dashboard; no new background-job/polling mechanism needed for a ≤10-page scan) → draft Q&A pairs appear as editable/removable rows the admin merges into their existing list before hitting the existing Save button. Never writes to `Tenant.faqs` directly from the crawl step itself.

**4. Explicitly deferred, noted but not built now**: the widget auto-detecting its own domain and prompting the dashboard to offer a scan (mentioned when the widget was scoped) — a real, nice discovery convenience, but adds a client-to-dashboard signaling path this doesn't need for a v1 where the admin can just paste the URL themselves. Revisit if onboarding friction from typing the URL manually turns out to matter in practice.

### Recognition/identity model — user insight (2026-08-21) and a related fix shipped the same day

User shared a detailed identity-recognition model (WhatsApp-number lookup → known/unknown branching, a 4-state model — known account / known contact-lead / unknown visitor / known-but-unverified — and a public/authenticated/internal knowledge split for the crawler) after live-testing the shipped widget and asking why an unrecognized visitor kept hearing "I don't recognize you." Evaluated against the real codebase rather than accepted at face value, per the user's own request:

- **Already built, not a gap**: the "known ≠ full access" second layer (OTP/step-up gated by risk level) — this is `evaluateCapabilityGate()`, shipped in Phase 3, already exactly matches the user's model.
- **Already structurally true, not a gap**: the crawler can only ever produce "public knowledge" — it fetches unauthenticated public pages only, so it cannot reach authenticated or internal data by construction. The human-review-before-publish step already scoped is the correct safety net for the one real residual risk (a school accidentally publishing something sensitive on a public page), not a new categorization system.
- **Genuinely new, real, deliberately NOT built now**: lead capture for unknown inquirers ("I want to enroll" → collect name/child/grade/contact → create a prospective-parent record → notify admissions) — connects directly to the audience/consent gap already named when Phase 8 (outbound) was scoped (`Contact` has no "lead" concept today). Needs its own scoping pass. Also deferred: a website↔WhatsApp identity bridge (a button linking a website session to a WhatsApp identity via a session-reference deep link) — clever, real, nontrivial, not started.
- **The one real, immediately actionable bug the discussion surfaced**: `awaiting_identify` treated literally any message other than "cancel" or a bare greeting as a failed ID-match attempt — so a genuine question from a brand-new prospective parent/visitor ("what are your fees") got swallowed into "I couldn't match that admission number" instead of being answered. This directly undercut the widget's primary intended audience (strangers inquiring). **First fix, commit `910a77c`, Railway `cc27c955`**: both the first-contact welcome and the `awaiting_identify` resume handler answer a genuine question via the org's FAQs instead of repeating the ID prompt — used `looksLikeAQuestion()` (already proven for the order flow) to detect "this isn't an ID attempt."

  **User live-tested this in production and found it still broken for "hello how are you"** — reported directly, investigated seriously rather than assumed fixed. Root cause: `looksLikeAQuestion()` only catches a literal "?" or a message STARTING with a question word; "hello how are you" starts with "hello" (not "how"), isn't a pure greeting either (`isGreeting()` caps at 3 words, this is 4), and has no "?" — so it fell through both checks straight into a failed ID-match, exactly as the user observed. **Corrected same day, commit `b18ccd5`, Railway `da5a3953`, confirmed Online**: replaced the narrow "does this look like a question" filter with the inverse, more robust `looksLikeIdAttempt()` — does this message plausibly look like an ID at all (short, contains a digit, no ordinary English words)? Defaults to "not an ID" (answer it for real) for anything ambiguous. Re-verified against the EXACT phrase that failed, on both local dev and production directly — now gets a genuine, friendly reply. Also confirmed a genuinely bad ID ("STU-999", doesn't exist) still correctly gets the honest "couldn't match" response — this isn't a blanket bypass. 73/73 regression suite clean on both passes.

  **Lesson for this feature area specifically**: a "does this look like X" classifier is safer built as "does this look like the NARROW thing we're trying to detect" (an ID) than as "does this look like the broad universe of everything else" (a question) — the broad side is much easier to under-specify and miss real cases, as this correction shows directly.

**2. Embeddable chat widget (build second)** — by the time this ships, orgs already have real, human-approved FAQs (crawled-then-approved, or manually typed) sitting in the same place every other channel reads from, so the widget needs no separate content-integration work — it inherits existing knowledge automatically. This is what makes "drop in a script and it already knows the site" true in practice: run the crawler once during onboarding, approve the draft, then hand over the embed script.
- A single `<script src="https://p2less.io/widget.js" data-org="...">` tag, injecting a chat bubble UI, talking to the same underlying engine as `/api/channels/webchat`.
- **`data-org` must be a separate public-safe "site key," not the private developer API key** — least-privilege: a widget embed can be seen by anyone viewing page source, so it must only be able to identify which tenant to route to, never usable to pull data via the general developer API.
- **Real rate-limiting on the public widget endpoint, built in from day one, not deferred**: unlike WhatsApp (phone-verified) or the developer API (key-authenticated), a public website widget is the most anonymous, most exposed surface P2Less would have. This is also the highest-priority place to finally close the "no general API rate limiting anywhere" gap already named in the system discovery audit — build it here first, don't defer it again.
- **Requires an existing P2Less tenant — not a way to create one.** `data-org` must point at an organization already provisioned on P2Less, same as WhatsApp needs a tenant to exist before a number connects to it. The widget is a delivery mechanism, not a signup flow.
- **Installing the widget does NOT itself trigger a crawl.** By design (see the crawler's own "never auto-publish" rule above), pasting the script is a separate action from scanning the site — no silent/automatic content ingestion just from embedding. **Nice discovery refinement, not a shortcut on safety**: since the script runs on the org's own page, it already knows its own domain — on first load it could notify the dashboard "we're now live on `<detected domain>` — want to scan this site?", saving the admin from retyping the URL, while the actual review-and-approve step stays mandatory exactly as scoped above.

**No-code installation paths, so "doesn't want to touch code" isn't a blocker** (in priority order):
1. Most website platforms already have a built-in, admin-panel "paste code here" field that isn't editing source files — WordPress ("Custom HTML" widget or the free "Insert Headers and Footers" plugin), Squarespace (Settings → Advanced → Code Injection), Wix (Settings → Custom Code), Shopify/Webflow (theme code-injection settings). For an org with basic admin access to their own site, this already counts as no-code.
2. If the site already runs Google Tag Manager (common for businesses doing any analytics/ads), the script can be added as a GTM tag through GTM's own UI — no site-editing at all. Worth checking for during onboarding.
3. **The genuine fallback, matching the existing WhatsApp-connection pattern**: if neither applies (an old static site, no CMS, no admin access), someone on P2Less's side does the one-time paste for the client during onboarding — not a new operational pattern, the same white-glove model already used for connecting a WhatsApp number today.
4. **Real product-level answer if this becomes a common ask**: purpose-built marketplace plugins (a WordPress plugin, a Shopify app) installable by a non-technical person with one click from their own platform's app store — genuinely zero-paste, not just zero-code. Real additional scope beyond the base widget script; worth its own line item only once there's real demand for it.

**Recommended sequencing**: crawler/ingestion before the widget (ships value sooner, on existing channels, and removes the widget's biggest open question — "where does its knowledge come from" — before the widget itself is even started).

### Phase 8e — widget implementation detail — ✅ SHIPPED 2026-08-20

Concrete build plan, checked against the real existing code so it reuses established patterns rather than inventing new ones — confirmed `channelType` on `Contact` is a plain `String` (not an enum), so `"widget"` as a new channel value needs zero schema change there.

**1. New data model — a PUBLIC site key, structurally distinct from the private developer `ApiKey`**:
```prisma
model WidgetKey {
  id             String    @id @default(cuid())
  tenantId       String
  tenant         Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  key            String    @unique // public identifier — safe to expose in page source, NOT a secret
  allowedOrigins Json      // string[] of allowed domains; empty = dev/testing mode (any origin, logged)
  active         Boolean   @default(true)
  createdAt      DateTime  @default(now())
  lastUsedAt     DateTime?

  @@index([tenantId])
}
```
Deliberately NOT reusing `ApiKey` (which is hashed, secret, and scoped to the privileged developer API) — a widget key is public by design (anyone can view page source), so the security boundary can't be "keep the key secret." It has to be: origin allowlisting + rate limiting + the widget route being structurally incapable of reaching anything the general developer API can.

**2. New route, NOT a reuse of `/api/channels/webchat`**: `/api/channels/widget/route.ts`. The existing webchat endpoint is fine for the internal `/demo` simulator but has zero origin-checking or rate-limiting — wrong to expose directly to arbitrary public websites. The new route:
1. Accepts `{ widgetKey, text, sessionId }`.
2. Looks up `WidgetKey` by `key`, requires `active`, checks the request's `Origin`/`Referer` against `allowedOrigins` (skip check only if the list is empty — logged as dev-mode usage, not a silent bypass).
3. **Real rate limiting here — the actual fix for the audit's "no general API rate limiting anywhere" finding, applied first where it matters most**: per-`widgetKey` and per-IP token bucket.
4. Resolves/creates a `Contact` scoped to `(tenantId, channelType:"widget", address: sessionId)` — the exact same `Contact`/`Conversation` shape every other channel already uses, `sessionId` playing the role a phone number plays elsewhere.
5. Calls the SAME `handleInbound()` — zero new conversation logic. OTP step-up, permission checks, everything already enforced there applies unchanged to widget visitors.

**3. Frontend — `widget.js`, vanilla JS, no framework dependency** (keep the bundle small and free of anything that could collide with the host site's own JS/CSS):
- Reads its own `<script data-key="wk_...">` tag (renaming from the earlier illustrative `data-org` — the attribute holds the `WidgetKey.key` value, not the tenant slug, since that's what the route actually looks up).
- Generates/persists a `sessionId` in `localStorage` so a returning visitor keeps their conversation.
- Renders a floating bubble + collapsible chat window; optionally pulls `Tenant.branding.primaryColor` (already a real field) for a lightly on-brand look.
- Renders both `body` text replies and `kind:"image"` replies — reuses the exact image-reply shape already built for WhatsApp product photos, no new reply type needed.

**4. Dashboard UI — new page, e.g. `/dashboard/widget`**: generate a `WidgetKey`, show the exact copy-pasteable `<script>` snippet, an input for allowed domain(s), and a live count of widget-originated conversations (filter the existing Conversations list by `channelType:"widget"` — no new list view needed, just a filter).

**5. Build/test order**: schema migration (additive, same low-risk shape as every prior migration this session) → widget API route + rate limiting → dashboard key-management page → `widget.js` → local end-to-end test (embed in a throwaway static HTML page, verify a full conversation including an OTP-gated read to confirm nothing bypasses existing security, verify a mismatched-origin request is rejected, verify the rate limit actually triggers) → deploy → smoke-test against a real or throwaway page pointed at production, same standard as every other live-verification this session.

---

## Phase 9 (IN PROGRESS, PAUSED 2026-08-20) — WhatsApp Self-Service Onboarding (Embedded Signup)

**Status: genuinely started, NOT done — paused mid-setup to work on the multi-channel vision (Phase 8a-8e) instead, at the user's explicit direction. Recorded here precisely so it isn't lost.**

**Why this matters**: today, connecting a new client's real WhatsApp number requires a P2Less operator to run `scripts/connect-number.ts` with real Meta-issued credentials — not self-service. This was identified as the single highest-leverage remaining onboarding gap (every other step in `/onboard` — tenant creation, roles, owner login — is already automated; this is the one manual step left). Real Meta "Embedded Signup" replaces that operator step with the client completing a Meta-hosted popup flow themselves.

**What's confirmed already in place** (verified directly against `.env` and Meta's dashboard during this session, not assumed):
- The Meta App already exists and is functional: App ID `2450932552082438`, App Secret already set as `WHATSAPP_APP_SECRET` (used today for webhook signature verification), `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_VERIFY_TOKEN` also already configured — this is the SAME app that already sends/receives real WhatsApp messages for the existing demo/production numbers.
- The app is linked to a real, active Meta Business Manager ("Hamzone Technologies" business portfolio) — confirmed via screenshot, with real Apps and WhatsApp accounts already listed under it.
- The WhatsApp product is already added to the app, with the existing "Integrate with API" (single own-number) path already fully working — this is a DIFFERENT path from what Embedded Signup needs (Embedded Signup is for onboarding OTHER businesses' own numbers, not the app owner's own).

**Exactly where we left off, step by step** (so this can be resumed without re-discovering any of it):
1. Navigated to `developers.facebook.com/apps/2450932552082438` → **Use cases** → **Connect on WhatsApp** → confirmed the "Integrate with API" vs "Become a Partner" fork exists, and that "Become a Partner" (not "Integrate with API") is the correct path for onboarding *other* businesses' numbers on P2Less's behalf.
2. Clicked into **Become a Partner → Become Tech Provider**.
3. Reached the **"Onboard as a Tech Provider"** dialog, presenting two choices: *Independent Tech Provider* (no partner app ID, can work with partners later, App Review required) vs *Working with a Solution Partner* (needs a partner's app ID, App Review required). **Selected "Independent Tech Provider"** — correct choice, since P2Less is building this directly rather than going through an existing Meta Solution Partner.
4. **This is the exact point work paused.** The next click (continuing past this dialog) was never taken — we don't yet know what that screen shows, whether it leads straight to an Embedded Signup configuration screen with a `config_id`, or requires other steps first (e.g. business verification documents, a description of the use case for review).

**What's still needed to finish this phase**:
1. Resume from the "Independent Tech Provider" dialog, continue the Tech Provider onboarding flow, and locate the actual **Embedded Signup configuration** screen (create a configuration, choose requested permissions — at minimum `whatsapp_business_management` + `whatsapp_business_messaging` — and obtain the resulting **`config_id`**).
2. **Confirmed requirement, not yet started**: Meta **App Review** (Advanced Access) for those permissions is required before Embedded Signup can onboard *real client* WABAs — the app's own "Become a Tech Provider" card literally states this ("submit to App Review and request access to... data from other businesses"). Development-mode testing against the app owner's own test WABA works without this; onboarding actual clients does not.
3. Once App ID + `config_id` are both in hand: build the actual integration — client-side Embedded Signup popup (Meta's JS SDK), server-side authorization-code → access-token exchange, then using the Graph API to fetch the new WABA's phone_number_id and register/subscribe it — replacing the currently-stubbed section of `provisionOrganizationAction` (`src/lib/actions.ts:111-179`, which today only creates a `WhatsAppNumber` row with `verificationStatus:"pending"` and no real Meta handshake, by the code's own honest comment).
4. Live-verify end-to-end against a real test WABA before considering this done, same standard as every other integration this session (M-Pesa sandbox, Resend email, etc.) — never claim a Meta integration works without an actual completed signup proven live.

**Explicitly not resuming yet** — paused at the user's direction to work on Phase 8 (multi-channel) and widget scoping instead. Resume only when explicitly asked.

---

## Existing vs. Planned vs. Recommended vs. Future-Strategic

| | Status |
|---|---|
| Connector engine, grounded AI, 7-provider failover, RBAC, audit, Incident/Notification event model | **Existing** — reused as-is by every phase above |
| `Branch` hierarchy schema, `ConnectorAction` risk/approval fields, `FactSource` provenance type | **Shipped — Phase 1** |
| Branch-scoped routing/RBAC dimension | **Shipped — Phase 2** |
| Capability gate function (`evaluateCapabilityGate`) | **Shipped — Phase 3** |
| Provenance-typed known-facts, `resolveFieldConflict()` (unwired, no live caller yet) | **Shipped — Phase 4** |
| Workflow-engine primitive (`evaluateWorkflowAsk`) + sub-roadmap | **Phase 5** — primitive shipped; `awaiting_resource_pick`, `awaiting_param`, `awaiting_confirm`, and all 6 `awaiting_order_*` states (9 total, all 2026-08-20) now use it. The order-flow slice was a genuine feature addition (reroute/pushback/abandon didn't exist there before), not a pure refactor. 4 bespoke-candidate flows (`awaiting_otp`/`awaiting_identify`/`awaiting_cv_details`/`awaiting_delivery_feedback`) deliberately still NOT migrated — may stay permanently bespoke |
| OpenAPI-driven connector drafting | **Shipped — Phase 6** |
| Marketplace, social media, OCR pipeline, research tooling | **Future-strategic** — do not start before a real need exists |
| Mode 1 channel expansion — Facebook Messenger + Instagram DMs (reactive, same engine as WhatsApp) | **Scoped, ready to build — Phase 8a, scoped 2026-08-20, not started.** Lowest-risk item on this roadmap: reuses `handleInbound()` unchanged, no marketing-template/consent restrictions since it's reactive. TikTok explicitly deferred (harder API access) |
| Auto-publish new products to Facebook Page + Instagram (no ongoing human login) | **Scoped, ready to build — Phase 8c, scoped 2026-08-20, not started.** Low platform-ban risk (posting to an owned account, same as Meta Business Suite/Buffer); real risk is content staleness, not policy. Requires building real access-token health monitoring alongside it — flagged explicitly so it isn't skipped |
| Telegram + Email as additional Mode 1 channels | **Scoped — Phase 8d, scoped 2026-08-20, not started.** Telegram is the easiest channel on the whole roadmap (open Bot API, zero approval gate). Email is lower-priority — universal reach but a messier interaction shape than the chat channels |
| Embeddable chat widget | **✅ SHIPPED 2026-08-20** (commit `eca4a24`) — `WidgetKey` (public, origin-allowlisted, rate-limited), `/api/channels/widget`, `public/widget.js`, `/dashboard/widget`. Live-verified on production. |
| Website content ingestion (crawl → draft FAQs, human-approved) | **Scoped, ready to build — Phase 8e, scoped 2026-08-21, not started.** Extends the existing `/dashboard/faqs` page, real SSRF protection built in (a related, lower-urgency, pre-existing gap in `connector-engine.ts` was found and flagged while scoping this, not yet fixed) |
| Unrecognized-visitor real-answer fix (`awaiting_identify`) | **✅ SHIPPED 2026-08-21, corrected same day** (`910a77c` then `b18ccd5`) — a genuine question from an unlinked contact now gets a real FAQ-grounded answer instead of only "I don't recognize you." First fix's `looksLikeAQuestion()` check was too narrow (user caught "hello how are you" still failing in production); corrected to the more robust `looksLikeIdAttempt()`, re-verified against the exact failing phrase on production directly. |
| WhatsApp self-service onboarding (real Meta Embedded Signup) | **IN PROGRESS, PAUSED — Phase 9, started 2026-08-20, explicitly NOT done.** App ID + App Secret + Business Manager confirmed already in place; paused mid-way through Meta's "Become a Tech Provider" flow right after selecting "Independent Tech Provider," before reaching the actual Embedded Signup `config_id` screen. Full step-by-step resume point recorded above — do not re-discover from scratch, pick up exactly where noted |
| Multi-Channel Engine — Mode 2, outbound to known contacts (Facebook/Instagram/TikTok/SMS channels, marketing/notifications/follow-ups, consent/policy engine) | **Future-strategic — Phase 8, vision documented 2026-08-20, not started.** Today P2Less is WhatsApp(+webchat)-only and 100% inbound-triggered — no other channel and no proactive/marketing outbound exists in any form |
| Public Social Agent — Mode 3, replies to public posts/comments/mentions on Facebook/Instagram/TikTok/X (Grok-on-X style) | **Future-strategic — Phase 8b, vision documented 2026-08-20, not started.** Distinct from Phase 8: public-visibility blast radius, different per-platform APIs/compliance (X requires a paid API tier + automation disclosure; TikTok requires approved-partner access), needs a new social-listening layer and stronger brand-voice guardrails than exist today. Recommended to build assisted (human-approves-before-posting) first, after Phase 8, not before |

## Open questions only the user can answer before Phase 1 starts

1. Does the very first real multi-branch tenant exist yet, or is this purely architectural for now? (Changes whether Phase 2 gets a real pilot to validate against.)
2. Is the Capability schema meant to eventually replace `ConnectorAction` entirely, or sit alongside it as a richer descriptor? (Affects how aggressive the Phase 3 migration should be.)
3. Priority relative to Priority 6's one remaining open item (tenant-isolation hardening, explicitly deferred as "eventually") — does this roadmap's Phase 2 branch-scoping happen before, after, or alongside that hardening work, since both touch the same permission-resolution code paths?
