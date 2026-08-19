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

## Phase 5 — Generalized workflow engine — 🟡 PRIMITIVE SHIPPED 2026-08-19, migration NOT started

**Goal**: today's booking/order flows are each a hand-built `awaiting_*` state machine in `conversation.ts`. Generalize the pattern (trigger→check→ask→wait→validate→execute→notify→record) into a reusable workflow definition, keeping the existing flows as the first migrated examples rather than a parallel system.

- Full sub-roadmap written after actually reading all 12 `awaiting_*` handlers: **`docs/PHASE5-WORKFLOW-ENGINE-SUBROADMAP-2026-08-19.md`**. Built the genuine shared-decision primitive (`evaluateWorkflowAsk()` in `src/lib/workflow-engine.ts`, 7-case tested against the real observed behavior of `awaiting_confirm`/`awaiting_param`) but **deliberately did NOT migrate any existing flow** — two concrete blockers found while investigating, not assumed: (1) real regression risk to code hardened through many specific prior live bugs, (2) the local dev/test harness can't currently prove parity (every `Connector.baseUrl` is hardcoded to port 3000, this preview harness always runs on 3001 — confirmed as the root cause of 24/73 E2E test failures, unrelated to any code change). See the sub-roadmap for the recommended pilot flow, migration order, and what needs to be true before migration starts.

## Phase 6 — Developer platform: OpenAPI-driven connector drafting

**Goal**: a developer pastes/uploads an OpenAPI spec → P2Less proposes a draft `Capability` set (endpoints→actions, schemas→input/output) → human validates before it goes live. Builds directly on Phase 1's `Capability` schema; no new concept, just an assisted authoring tool for it.

## Phase 7 (Future-strategic, deliberately unscoped) — new verticals

Connector marketplace, social-media connectors + content pipeline, document/OCR ingestion beyond today's PDF-generation-only `Document` model, research/plagiarism tooling. Explicitly sequenced last: each is a large, mostly-independent product surface that consumes the Phase 1-3 foundation rather than requiring changes to it. Don't scope these in detail until the foundation phases are live and proven.

---

## Existing vs. Planned vs. Recommended vs. Future-Strategic

| | Status |
|---|---|
| Connector engine, grounded AI, 7-provider failover, RBAC, audit, Incident/Notification event model | **Existing** — reused as-is by every phase above |
| `Organization`/`Region`/`Branch` schema, `Capability` schema, provenance schema | **Planned — Phase 1** |
| Branch-scoped permissions/routing/config-cascade | **Planned — Phase 2** |
| Capability gate function, approval-via-Notification-Engine | **Planned — Phase 3** |
| Provenance-tagged replies, conflict resolution | **Planned — Phase 4** |
| Generalized workflow engine | **Recommended, not yet scoped in detail — Phase 5** |
| OpenAPI-driven connector drafting | **Recommended — Phase 6** |
| Marketplace, social media, OCR pipeline, research tooling | **Future-strategic** — do not start before Phases 1-3 are live |

## Open questions only the user can answer before Phase 1 starts

1. Does the very first real multi-branch tenant exist yet, or is this purely architectural for now? (Changes whether Phase 2 gets a real pilot to validate against.)
2. Is the Capability schema meant to eventually replace `ConnectorAction` entirely, or sit alongside it as a richer descriptor? (Affects how aggressive the Phase 3 migration should be.)
3. Priority relative to Priority 6's one remaining open item (tenant-isolation hardening, explicitly deferred as "eventually") — does this roadmap's Phase 2 branch-scoping happen before, after, or alongside that hardening work, since both touch the same permission-resolution code paths?
