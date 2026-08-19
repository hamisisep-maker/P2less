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

## Phase 3 — Capability-ize existing connector actions

**Goal**: retrofit today's connector actions to point at real `Capability` rows instead of loose per-action flags, and make the "can AI do this → authorized → confirm → execute" gate an explicit, reusable, testable function instead of logic embedded inline in `dispatchAction`.

- Migrate each existing `ConnectorAction`'s `requiresConfirm`/`requiresStepUp` into the Phase 1 `Capability` schema's `riskLevel`/`confirmationRequired`/`approvalRequired` fields — a data migration, not new user-facing behavior.
- New `evaluateCapabilityGate(capability, user, context)` in a shared lib, used everywhere `dispatchAction` currently inlines this logic — single source of truth for the risk ladder described in the vision doc.
- `approvalRequired` capabilities route through the **already-shipped Notification Engine** (Priority 6) to ask a human for approval — this is exactly the kind of event the engine was generalized for; no new delivery mechanism needed.

## Phase 4 — Provenance-tagged responses + conflict resolution

**Goal**: every fact P2Less states carries a Known/Calculated/Configured/Generated/Unknown tag, and cross-system field conflicts resolve via configured source-priority instead of silently picking one.

- Extend `buildKnownFacts()`/`humanizeReply()` (`conversation.ts`/`ai.ts`) to carry the Phase 1 provenance shape per fact, and make the AI prompt explicitly cite it ("this is RETRIEVED, state it as fact; this is GENERATED, never present as verified").
- New `resolveFieldConflict(field, candidates, orgPriorityConfig)` for the CRM-phone-vs-ERP-phone case — escalates to a human review queue (reuses the Support/Ticket model, doesn't invent a new one) when unresolved.

## Phase 5 — Generalized workflow engine

**Goal**: today's booking/order flows are each a hand-built `awaiting_*` state machine in `conversation.ts`. Generalize the pattern (trigger→check→ask→wait→validate→execute→notify→record) into a reusable workflow definition, keeping the existing flows as the first migrated examples rather than a parallel system.

- This is the highest-effort, highest-risk phase — depends on Phase 3's Capability gate and reuses Phase 2's approval routing. Recommend treating it as its own sub-roadmap once Phases 1-4 are proven, not planned in detail yet.

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
