# P2Less — Gap Register (the one current, evidence-backed list)

**Why this exists**: the user raised a serious, legitimate concern 2026-08-24 — a real production bug (two tenants able to both claim the same Facebook Page, with nothing in the database preventing it) surfaced a broader worry about missing CRUD operations, unenforced money/billing logic, and whether prior audit work was actually being tracked anywhere real. Investigation confirmed: a formal "Master Gap Register" audit *was* done 2026-08-23, but its findings were scattered across ~70 sections of `docs/OPERATIONS-GUIDE-2026-08-23.md` with no single current-status document — and several items marked "deferred" in an early section were quietly fixed in a *later* section of the same file, with no cross-reference. This document is the fix for that: one place, every known gap, current status verified against real code today, not copied from an old note.

**How to keep this honest going forward**: when a gap gets fixed, update its entry here directly (status + what fixed it + evidence) rather than leaving a stale note and writing a fresh mention somewhere else. When a new gap is found, add it here in the right category. This document is what gets checked first, not re-derived from scratch, the next time this kind of audit is asked for.

**Every item below carries real evidence** — either a direct code citation from today's re-verification, or (for the historical batch) a citation confirmed by an agent that read all 70 operations-guide sections and independently re-checked each claim against the current source tree, not just copied the guide's old text.

---

## Found and fixed today (2026-08-24)

### 1. Two tenants could both claim the same real external Page/bot/number — real production incident
- **Category**: security / data-integrity
- **What happened**: a real customer test revealed Hamzone Technologies' actual Facebook Page (`828105030394804`) was bound to the wrong tenant (Riverside Academy) — a message to the real Page got answered as if it were Riverside's school-onboarding bot, not Hamzone's.
- **Root cause, confirmed in the code, not assumed**: `Channel.@@unique([tenantId, type])` only ever stopped one tenant from having two Messenger channels. The `address` field itself (the real Page ID) had zero uniqueness constraint — only a non-unique lookup index. Nothing in the database prevented two different tenants from both owning the same real external identity, and the webhook resolves the owning tenant via `findFirst()` with no tiebreaker — meaning if it ever happened again, routing between the two tenants would be nondeterministic, not just wrong once.
- **Fixed**: removed the incorrect Channel row (Riverside's), then added `@@unique([type, address])` to the schema — the database itself now refuses a second tenant claiming an address another tenant already owns. Verified directly: a duplicate-create attempt now throws a real `P2002` constraint violation, not just a hoped-for check in application code.
- **A real deploy incident happened while shipping this** — see the entry below.

### 2. A real production deploy incident, caused by shipping the fix above
- **Category**: other (process/infrastructure)
- **What happened**: `prod-start.mjs`'s boot-time `prisma db push` crash-looped production for approximately one minute. Prisma's static safety check flags *any* new unique constraint as a potential data-loss risk regardless of whether real duplicates exist — already independently verified zero duplicates existed before the schema change shipped, but the check doesn't know that in advance.
- **Caught via a direct health check**, not by trusting the deploy tool's own status label — Railway's `deployment list` showed "SUCCESS" while the container was actively crash-looping underneath it.
- **Fixed**: a one-time `--accept-data-loss` flag for exactly one boot, confirmed via the real boot log that the schema synced cleanly with no error, then reverted immediately so future genuinely-destructive changes are still caught. A permanent comment now lives in `scripts/prod-start.mjs` documenting exactly what happened and the safe procedure to follow if this specific class of false-positive refusal happens again.

### 3. No way to cancel a subscription anywhere in the product
- **Category**: money-billing
- **Finding**: `cancelled` exists as a `Subscription.status` value with its own badge color on the tenant billing page — but grepped every place a `Subscription` row is ever updated across the entire codebase (renewal, grace period, suspension, reconciliation, paybill reference) and confirmed: nothing, anywhere, ever sets a subscription to cancelled. No tenant-facing button, no admin-facing one either.
- **Status**: still open. This needs a real design decision (immediate vs. end-of-period cancellation, whether cancellation should be tenant-initiated, admin-initiated, or both) before it's built — not something to guess at and ship silently.

### 4. No way to change a tenant's plan after signup — self-service or admin-assisted
- **Category**: money-billing
- **Finding**: `updatePlanAction` (`src/lib/admin-actions.ts`) looked like the answer at first read, but it edits the **global plan definition** (Professional's price, its limits) — not which plan a specific tenant is assigned to. Grepped every `Subscription` update across the codebase specifically for `planId`: it's set once at signup (`finalizeOnboarding`) and never touched again by any code path, anywhere.
- **Status**: still open. A Free-tier customer wanting to upgrade, or a Business customer wanting to downgrade, currently has no path to do it — not self-service, not even by asking an admin to do it for them, since the capability doesn't exist at all.

---

## Historical findings (2026-08-23 formal audit + earlier), current status re-verified against code today

*Compiled by an agent that read the complete `docs/OPERATIONS-GUIDE-2026-08-23.md` (all ~70 sections) and independently re-checked every claim against the current source tree — not copied from the guide's original notes, which in several cases were already stale (an item marked "deferred" in one section had actually been fixed several sections later, with no cross-reference back).*

### SECURITY

**Still open:**

1. **Tenant-scoping ORM extension fails OPEN, not closed, when no tenant context is set.** `src/lib/db.ts`'s auto-scoping Prisma extension runs queries fully unscoped (every tenant's rows) rather than blocking them when `getCurrentTenantId()` returns nothing — indistinguishable from a legitimate cross-tenant admin/job read. A hard fail-closed fix was attempted and broke production three separate ways (documented as a real incident); reverted to a warn-only `console.error`. **This is the single most consequential open item in the platform** — a documented, reproduced, currently-live gap in the core tenant-isolation mechanism.
2. **Meta Business Verification unverified** — Meta's own dashboard warned that API calls to advanced-access permissions will begin being blocked. *(Update: this was fully submitted 2026-08-24, walked through live end-to-end — see `EXTERNAL-REGISTRATIONS-CHECKLIST-2026-08-24.md` item #1, now "In review," Meta's own ~2-business-day estimate. Downgrade this to "resolved pending review" rather than fully open.)*
3. No per-row key-versioning for encrypted connector credentials — a future `CREDENTIAL_KEY` rotation needs the same manual, jointly-executed process again.
4. Connector output flows to 7 external AI providers — a real sub-processor/data-minimization question, unresolved (legal + engineering).
5. Prompt injection via connector responses — meaningfully bounded by three real layers (allowlisted field extraction → fixed template rendering → AI only rephrases already-complete text), but a poisoned field value could still influence one reply's styling. Residual risk, not structurally closed.
6. No SHOULD-tier second factor for recycled/reassigned phone numbers (a factor the school actually controls — PIN, last-payment-amount, DOB) — the CAN-tier 180-day staleness re-verification is built; this stronger factor is not.
7. Widget channel has zero attachment/file-upload capability — confirmed via grep, no upload mechanism exists in `widget.js`.
8. Audit-log hash chain isn't externally anchored — catches partial tampering (one row edited/deleted) but a full-DB-write-access attacker could still rewrite an entire chain and recompute consistent hashes.

**Fixed, verified against current code:**

9. Demo credentials no longer render/pre-fill in production `/login`.
10. SSRF vulnerability in the connector engine — `src/lib/ssrf-guard.ts` built and wired into both real connector-creation paths.
11. FAQ crawler's SSRF guard — was found to have quietly become the *weaker* of two implementations (missing CGNAT range, incomplete IPv6, failed open on DNS errors); unified with the shared guard.
12. DNS-rebinding TOCTOU window in the SSRF guard — closed via IP-pinning (`resolvePinnedAddress`/`pinnedRequest`), verified against real HTTP and HTTPS with valid-cert validation.
13. `CREDENTIAL_KEY` rotated from a guessable placeholder to a real random key — executed jointly with the user after automated `railway ssh` access was correctly blocked by the environment's own safety classifier.
14. Crisis/distress detection built (`detectDistressSignal`), checked first in `handleInbound`, before any state-dependent branching.
15. Audit-log hash-chaining built (core mechanism) — `src/lib/audit-chain.ts`.
16. Recycled/reassigned phone number CAN-tier fix — `Contact.lastVerifiedAt` + 180-day staleness gate, covering both the single-action and bundled-overview paths (a real in-memory-staleness bug was caught and fixed live during the second pass).
17. OAuth callback routes (Messenger, WhatsApp embedded signup) now establish tenant context — previously safe "by construction" only, not by the platform's structural backstop.
18. The real `AsyncLocalStorage.run()` vs `.enterWith()` Prisma-extension-callback bug — fixed by switching to `.enterWith()`.
19. Rate limiting on invite actions (5 per 10 minutes).
20. Staff offboarding/deactivation — `User.deactivatedAt`, checked in `getCurrentUser()`, bounces an active session on its very next request.
21. Password show/hide toggle — swept across all 5 real password fields via one shared component.
22. Internal AI-architecture log entries no longer leak onto a tenant's own audit page.

**Refuted — checked, confirmed not actually a problem, do not re-investigate:**

23. Connector calls inside the WhatsApp webhook are NOT synchronous — real background-promise dispatch with dedupe, safe specifically because this is a long-running container, not serverless.
24. OTP hardening claim was refuted — the real mechanism (5-min expiry, 3-attempt lockout, hourly issuance cap, hashed+timing-safe compare) already existed; the gap was in the audit's own documentation, not the code.
25. Webhook signature verification is real on all four channels (WhatsApp, Messenger, Telegram, Email), not WhatsApp/M-Pesa-only as claimed.

### MONEY / BILLING

**Still open:**

26. Multi-channel messages billed at one flat WhatsApp-specific rate — Messenger/Telegram/widget/email messages priced as if they incurred Meta/WhatsApp-specific costs, which they don't. A real, deliberately-deferred pricing-granularity decision.
27. No per-tenant AI spend ceiling — `AiRequestLog` tracks cost after the fact; nothing caps it.
28. *(New today, see above)* No subscription cancellation flow.
29. *(New today, see above)* No tenant plan-change flow.

**Fixed:**

30. Plan seat/connector limits were configurable but never enforced — `checkSeatLimit()` now wired into every real creation path (staff invite, both connector-creation paths).
31. `Subscription.paybillReference` was never actually populated by any code path — direct PayBill deposits silently fell to manual reconciliation. Now wired.
32. Tenant billing page previously exposed P2Less's own cost structure and gross margin directly to the paying client — removed.

**Product decisions, not bugs:**

33. No compliant tax invoice/VAT/ETIMS handling — explicitly out of scope per the user's own direct instruction.
34. Channel connections are free/included in plan, not separately billed — confirmed intentional.

### DATA INTEGRITY

**Still open:**

35. `Conversation.channelId` relation defined in the schema but never actually wired (0 of real conversations use it) — worked around everywhere via `Contact.channelType` instead, so the practical gap is closed but the dead schema field itself was never removed.
36. `NotificationRule.template` has a write path in the DB but is never read anywhere — placeholder substitution doesn't exist.
37. Dual-write problem — the `Message` table write and the actual outbound send aren't spanned by one transaction; a failed send after a successful write produces a transcript gap.
38. No idempotency key on side-effecting capability execution under AI provider failover — a capability could theoretically execute twice under a specific failover-timing race.
39. No duplicate-ticket accept/reject UI — a reviewer can see a suggested-duplicate cluster but can't confirm/dismiss it.

**Fixed:**

40. Duplicate-escalation detection built (`findLikelyDuplicate`), course-corrected mid-build from comparing AI replies (too variable) to comparing the customer's own message (more robust).
41. The escalation-swallowing bug (a user asking for a human mid-flow getting a decline instead) — fixed at the root by consolidating to one `isEscalationRequest` definition checked at all three reply-generating branches, after recurring three separate times as independently-fixed instances.
42. Escalation replies now include the real ticket reference number.

### MISSING CRUD

**Fixed:**

43. Tenant staff invite (`/dashboard/users` was read-only before).
44. Platform-admin provisioning through the UI (was "provisioned outside this UI today").
45. Tenant owner email now shown in the admin tenant list.
46. Plan-tier count breakdown built.
47. Search across conversations (tenant and admin side).
48. Admin-wide conversations view across every tenant.
49. `Tenant.name`/`industry`/`branding` now editable after signup (`/dashboard/settings`).
50. `useCases`/`channelsNeeded` now editable after signup.
51. Messenger media attachments + postback-button handling (was stated v1-scope text-only).
52. Messenger outbound was silently dropping image/document attachments, sending only caption text — fixed.
53. WhatsApp Cloud API access-token health monitoring — was structurally incapable of ever detecting a dead token; real live check now wired in, plus a new incident-detection alert.

**Still open:**

54. No unified `/admin/messages` inbox across channels.
55. No Reports Centre (Operational/Quality/AI/Assurance sections).
56. The Evidence & Assurance subsystem's schema (`TestExercise`/`TestCase`/`Finding`/`AssuranceReport`) doesn't exist yet — deliberately sequenced to wait for real pilot findings volume, not a bug.

### PRODUCT DECISIONS (deliberate, not bugs — listed so they aren't mistaken for gaps later)

- No interactive "report a problem" structured flow (plain phrase-match escalation instead).
- No channel-specific "nearest supported path" message for unsupported file uploads.
- Ticket status is 7 real values, not a proposed 10-stage flow.
- No category-based auto-routing or severity-based incident fan-out — any future routing engine must key off `ticket.actionRequired`, a verified conclusion, not raw ticket text.
- No product analytics/presence SDK (PostHog/Mixpanel/GA) — deliberately not built as premature infrastructure at current volume; a minimal honest "recently active" approximation shipped instead.
- Full personal Training/Live context isolation (dedicated tester identity, staging/promote for knowledge) — recorded as the permanent post-launch operating model, not built beyond the current phone-number-based enrollment.
- Full 3-tier operating-mode/feature-flag system — only the single `public_registration_enabled` (and now `quality_feedback_invitation_enabled`) flags were built; the rest deliberately deferred as premature for a single-founder pre-launch product.
- No tenant-side escalation/ticket queue (admin-only today) — a real, explicit product-model decision ("does the tenant handle their own escalations, or is P2Less selling a managed support desk"), not a bug either direction.

### OTHER

- System Trace panel doesn't show intent-match/authorization-check rows as their own audited events — still open.
- Sycophancy-under-pressure is now a permanent regression test (`scripts/test.ts`) — confirmed the assistant doesn't cave to a customer disputing a correct system-returned value.
- The external-registrations checklist had three stale entries, corrected during a full live re-verification pass 2026-08-24 (documentation corrections, not code gaps) — see `EXTERNAL-REGISTRATIONS-CHECKLIST-2026-08-24.md`.

---

## What this means, stated plainly

The two most consequential items on this whole list are **the tenant-scoping fail-open default** (security section, item 1) and, until Meta's review clears, **Business Verification** (item 2, now submitted and pending). Everything else still open is real but lower-severity — either a genuine, deliberately-scoped-later feature gap (billing self-service, a few dashboard views), or a deliberate product decision correctly not mistaken for a bug.

The pattern behind today's incident — a missing database-level constraint letting bad state exist that application code alone should have prevented — is worth watching for specifically when reviewing any future *new* channel/connector/external-identity feature: does the schema itself enforce the invariant, or only a code path that could be bypassed by a second code path nobody thought to check.
