# P2Less — Universal AI Access, Automation & Integration Platform

**Status: vision/roadmap input, not yet scoped into a plan.** Captured verbatim from the user 2026-08-19 as "the foundation for the next P2Less architecture/roadmap." Nothing in this document has been built. Read alongside `docs/SYSTEM-DISCOVERY-2026-08-19.md` (what actually exists today) before treating any of this as current state.

## Core reframing

P2Less is a **universal digital access, automation, integration, AI and communication layer** — people and organizations use their *existing* systems through conversation and automated workflows, without replacing them. **Augmentation, not replacement** is the load-bearing principle.

One-sentence pitch: *"Connect your existing systems to P2Less, and P2Less gives your people one intelligent way to access information, perform actions, automate work and communicate across those systems."*

## Architectural rules the user wants held as fundamental

1. **Never fabricate certainty.** Every fact must be tagged Known (retrieved) / Calculated / Configured / Generated (AI) / Unknown — "I don't know" must never become "I think this is probably...". P2Less already does a version of this (grounded AI, `classifyOutcome`'s unknown≠failed) — this generalizes it into an explicit provenance model across all data, not just payments.
2. **Four modes**: Connect (integrate existing systems) / Operate (conversational access to them) / Automate (workflows) / Create (P2Less as the system of record when the org has none). Maps onto "Integrated / Standalone / Hybrid" deployment shapes — a business can start standalone and later plug in a real ERP without losing the conversational layer.
3. **Authority model for autonomous operation** (owner absent): every action gates through *Can AI do this? → Is user authorized? → Is confirmation required? → Execute.* This already exists in miniature (`requiresConfirm`/RBAC/OTP step-up) — the vision generalizes it into a formal per-capability risk/confirmation/approval schema (see Capability Model below).
4. **Capability Model**: every action P2Less can take should be a registered `Capability` (name, source system, action, input/output schema, auth, authorization, risk level, confirmation requirement, human-approval requirement, timeout, retry policy, failure behavior, audit requirements, cost). P2Less "selects from known capabilities," never freeform-executes. This is a significant generalization of today's `Connector`/action-schema system, not a new concept.
5. **Source-of-truth / conflict resolution**: every field needs provenance (source system, record id, retrieved-at). Cross-system conflicts (CRM phone ≠ ERP phone) resolve via configured source-priority, never a random/AI guess — escalate to human review if unresolved.
6. **Say no as a trust feature**: "I cannot do that" / "not authorized" / "system unavailable" / "need confirmation" / "need human review" / "could not verify" are explicitly framed as trust-building, not weaknesses.

## Multi-branch organization architecture (the concrete near-term structural gap)

**Branches are not separate tenants** — they're first-class parts of one organization sharing identity, policy, systems, reporting, users, AI config, governance, while allowed independent operation where needed. Today's schema has no branch concept at all — every tenant is flat.

Proposed hierarchy: `Platform → Organization → [Region] → Branch → User/Contact → Capability → System → Action`. Branch resolution uses multiple signals (explicit request, user's home branch, contact history, appointment/transaction location, org-configured default) — not just destination WhatsApp number, though branch-specific numbers should also work (a number can map straight to a branch, or a central number can ask "which branch?").

Key mechanics called out explicitly:
- A person keeps ONE identity across branches of the same org (no duplicate customer records per branch) — but a staff member's permissions are scoped by **both** what they can do and **where** (branch/region/all).
- Config inheritance cascades: `platform default → org policy → region policy → branch policy → department policy → user rule`, most specific wins (e.g. branch-level business-hours override).
- Branches can run **different underlying systems** (Nairobi on System A, Mombasa on System B) — P2Less normalizes via the connector layer, doesn't force migration.
- Cross-branch operations (inventory transfer, "return an item at a different branch than purchased") follow the same confirm/authorize/audit workflow pattern as any other capability.
- Billing, analytics, and incidents should all be branch-attributable ("Mombasa's payment connector is failing," not just "payment integration is failing") — this is a natural extension of the *existing* Priority 4 Incident/health model, not a new one.
- Explicit warning against building "Nairobi P2Less / Mombasa P2Less" as separate app instances — one platform, one org, multiple operational scopes, mediated by a single permission engine.

## Other major surfaces described (not yet scoped, listed for completeness)

- **Social media management**: connect FB/IG/TikTok/X/LinkedIn: content generation with a draft→approval→publish (or auto-publish) pipeline; comment-triggered commerce (someone asks price on a post → P2Less identifies product, replies, can hand off to WhatsApp/create a lead or order).
- **Document/image/voice intelligence**: upload-and-query documents, OCR on receipts/IDs/forms → structured data explicitly marked "extracted, not verified," voice-note transcription → intent → action.
- **Research/student tooling**: literature/document assistance, plagiarism/AI-detection reporting that never claims certainty ("indicates characteristics associated with," never "this student plagiarized").
- **Developer platform**: connector builder (ideally auto-drafted from an OpenAPI spec, human-validated before going live), SDK/webhooks/workflow engine as reusable infra so a developer building on P2Less never re-implements auth/conversation-state/WhatsApp/AI-routing/usage-metering themselves.
- **Connector marketplace**: developers publish connectors by sector (accounting, schools, healthcare, HR); an org "installs" one instead of commissioning a bespoke integration.
- **Workflow engine generalization**: today's single-step confirm-then-execute pattern (booking, orders) generalizes into multi-step trigger→check→ask→wait→validate→execute→notify→record flows with human-in-the-loop gating by risk tier (low=auto, medium=confirm, high=approval, unknown=human review) — leave-request-with-manager-approval is the example given.
- Sector-specific notes for schools/hospitals/government/SACCOs/researchers/individuals all reduce to the same primitive chain: **Identity → Data → Capability → Permission → AI interpretation → Workflow → Connector → Verification → Action → Audit → Notification.**

## What the user explicitly wants avoided

- "Add 100 random features" — the ask is a **capability platform** where every new sector reuses the same primitives above, not a pile of one-off sector modules.
- Positioning as "another WhatsApp chatbot" — pitch is the access/orchestration layer regardless of channel.
- "Same organization = everyone sees everything" — multi-branch must not collapse into org-wide open access; isolation and interconnection are both required simultaneously.

## Relationship to what's actually built today (per `docs/SYSTEM-DISCOVERY-2026-08-19.md` and 6 shipped priorities)

Strong existing foundations this vision builds ON TOP OF, not around: real connector engine + grounded/anti-hallucination AI, 7-provider AI failover, tenant/RBAC/audit system (Priority 3), Integration/JobRun/Incident operational model (Priority 4), Customer Ops Centre (Priority 5), and the Notification Engine (Priority 6) — the "detected → reaches a human" backbone this vision's workflow-engine/human-in-the-loop ideas can plug straight into.

Genuinely absent today, load-bearing for this vision: any branch/org-hierarchy concept, a formal Capability registry (today's connector actions are close but don't carry risk-tier/approval-tier as first-class fields), a provenance/source-of-truth model for cross-system field conflicts, social-media connectors, a document/OCR pipeline beyond the existing PDF-generation-only `Document` model, a connector marketplace, and an OpenAPI-driven connector-drafting tool.

This is a multi-quarter direction, not a single priority — needs to be broken into a real phased roadmap before any implementation starts.
