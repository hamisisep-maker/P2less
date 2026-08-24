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

### 3. RESOLVED, 2026-08-24 — subscription cancellation now exists, admin-only
- **Category**: money-billing
- **Finding**: `cancelled` existed as a `Subscription.status` value with its own badge color on the tenant billing page, but nothing anywhere ever set it — no tenant-facing button, no admin-facing one either.
- **Real design work done, not guessed at**: a self-service version was built first (tenant-initiated, cutoff gated behind a real-time M-Pesa settlement payment), then walked through what actually happens if that payment is never completed — a tenant who ignores the STK PIN prompt would stay fully active, still costing Hamzone real Meta/AI money, indefinitely, since the subscription would still read "active" to `runBillingCycle()` and the existing non-payment grace-period machinery wouldn't engage until the next natural renewal date (potentially weeks away). Corrected mid-build: cutoff must be unconditional and immediate, payment collection fully decoupled from it. Then redirected entirely: self-service cancellation was rejected outright in favor of admin-only, and the settlement mechanism itself was reconsidered — an automated real-time M-Pesa push at the exact moment a subscription is being cancelled isn't the right moment for that; instead the final cycle's usage is billed (a real `Payment` row, `status: "pending"`, `purpose: "cancellation"`), emailed to the tenant's owner as an itemized invoice via Resend, and recorded in the audit trail — collected afterward like any other outstanding invoice, not pushed for in the moment.
- **Shipped**: `cancelTenantSubscriptionAction` (`admin-actions.ts`), gated by a new `tenants.cancel` permission (held by `super_admin`/`operations_admin`, deliberately not `support_admin`), wired into `/admin/tenants` next to Suspend/Reactivate with the same required-reason confirm pattern. `finalizeCancellation()` (`billing-lifecycle.ts`) is the actual cutoff — sets `Tenant.status`/`Subscription.status` to `"cancelled"`, reusing the same access-gate `conversation.ts` already used for `"suspended"` (now recognizing both). Guarded against a real race found while designing this: a renewal charge already in flight when a tenant is cancelled can still resolve afterward via the M-Pesa webhook — `handleSubscriptionPaymentConfirmed`/`recordFailedPayment` now both check for an already-cancelled subscription first and skip reactivation/retry-scheduling, so a stray late payment can never silently undo a real cancellation.
- **Verified live**, not just typechecked: cancelled a real seeded tenant (Nairobi Hospital) end to end as the real super admin — `Tenant.status`/`Subscription.status` both flipped to `cancelled`, the webchat access gate immediately returned "This number is not in service," the `Payment` row and privileged-action audit entry both recorded the correct outstanding amount (KES 20,519, real usage-based), and the email attempt hit Resend's real API and failed *honestly* with a real, informative error (sandbox mode only sends to the account's own verified address) — recorded in the audit detail, not silently swallowed. Production needs a verified Resend sending domain before this email is actually deliverable to real tenant addresses — a real, separate follow-up, not a code bug.
- **Deliberately not built this round**: a way for a tenant to pay off an old cancellation invoice online — an admin with `billing.confirm_payment` resolves it manually once money arrives by whatever channel, same as any other manual reconciliation today.

### 4. RESOLVED, 2026-08-25 — plan changes now exist, split by direction and risk
- **Category**: money-billing
- **Finding**: `updatePlanAction` (`src/lib/admin-actions.ts`) looked like the answer at first read, but it edits the **global plan definition** (Professional's price, its limits) — not which plan a specific tenant is assigned to. Grepped every `Subscription` update across the codebase specifically for `planId`: it's set once at signup (`finalizeOnboarding`) and never touched again by any code path, anywhere.
- **Real trap found before building anything**: `computeBill()` reads `plan.priceMonthly` fresh against usage counted since the start of the *calendar* month, with no record of which plan was active on which days. An immediate plan change mid-cycle would silently apply the new rate to the whole month, including days spent on the old plan — no proration mechanism exists anywhere in this codebase (confirmed when cancellation was built), so this isn't something to quietly patch, it's a real decision.
- **Also found while designing it**: `Plan.priceMonthly` alone can't determine upgrade vs. downgrade — checked the real seed data first: Enterprise prices at 0 (same as Free) but is obviously the top tier. `Plan.sort`, the field that exists specifically for tier ordering, is what direction is read from instead.
- **Design landed on, split by real risk**: upgrades are tenant self-service (`upgradeSubscriptionPlanAction`, `actions.ts`) and apply **immediately** — an explicit, honest "the whole current bill charges the new rate, no partial-month credit" rule, safe because it only ever increases revenue. Downgrades are **admin-only** (`changeTenantPlanAction`, gated by a new `tenants.change_plan` permission) and are **deferred to the next renewal** (`Subscription.pendingPlanId`, applied by `runBillingCycle()` right as the old cycle ends) — closes the exact gaming risk of downgrading right before a bill is computed to shrink what's owed for usage already incurred at the higher rate.
- **Verified live**, not just typechecked: upgraded a real seeded Free-tier tenant (Kilimani Retail) self-service — plan fee and total bill updated immediately and correctly (KES 619 → KES 5,519, exactly the Professional plan fee difference). Scheduled an admin-initiated downgrade on the same tenant — confirmed `planId` stayed on the old plan and `pendingPlanId` was set (not applied immediately). Forced `renewsAt` into the past and ran the real billing cycle (via the same `runCrossTenant` wrapping `runJobNow()` uses, not a shortcut) — confirmed the downgrade applied at exactly that point, `pendingPlanId` cleared, both the scheduling and application steps recorded as distinct audit entries.
- **Deliberately not built this round**: true proration (a blended mid-cycle rate) — consistent with cancellation's same choice, no proration infrastructure exists anywhere in this billing model yet.

### 5. IN PROGRESS, 2026-08-25 — prepaid billing redesign (post-paid → real KES balances)
- **Category**: money-billing
- **Why**: direct founder request — the old post-paid model (`computeBill()`/`runBillingCycle()`) let usage accumulate all month with payment only collected at renewal, leaving Hamzone exposed to a real, unbounded cost if a tenant never pays. Redesigned so every real, non-Enterprise plan draws down two separate prepaid KES balances (`Subscription.messageBalanceKes`/`aiBalanceKes`) checked **before** the real external cost (the actual WhatsApp send, the actual AI provider call), never after. Enterprise (`Plan.postpaidUsage`) keeps the original post-paid model untouched — a negotiated-contract trust tier. Trial is a state (`Subscription.status === "trial"`), not a plan — no `Plan` row is ever presented to a customer as "Free"; the existing "free" `Plan` row is repurposed as an internal-only, admin-configurable trial allowance reusing the existing `checkLimit()` count mechanism.
- **Shipped and live-verified**: schema (`messageBalanceKes`/`aiBalanceKes`/low-balance-notified timestamps/`balanceMigratedAt`), four real plans (Starter/Professional/Business/Enterprise) plus the internal trial allowance, channels free/unlimited on every tier (connectors keep their existing per-tier cap — deliberately NOT the same thing), the message-balance gate wired into `handleInbound` (`conversation.ts`), and — the real gap found and fixed today — the AI-balance gate/debit centralized inside `callLLM()` itself (`ai.ts`), the single real choke point every AI-calling function goes through (`understand`, commerce classification, order-step, FAQ extraction, `humanizeReply`, `smallTalk`, tool completions). First implementation only wired `understand()`'s call sites; live-verified with a real WhatsApp-style message that `smallTalk` produced an unmistakably AI-generated reply while the AI balance stayed untouched — confirmed via `grep` that `smallTalk`/`humanizeReply`/`complete` all call the provider directly and were entirely ungated. Moving the gate+debit into `callLLM` (rather than patching each caller) closes this structurally, the same "single source of truth" reasoning `understand()`'s own wrapper used originally. Re-verified live: a real reply now debits both balances correctly, and draining the AI balance to 0 degrades gracefully to the local/deterministic reply with zero balance/payment disclosure and no message-balance side effect.
- **Real regression found and fixed the same day**: every subscription that existed before this shipped has `messageBalanceKes`/`aiBalanceKes` at their schema default of 0 — the full local regression suite went from 73/73 to 31/73 passing the moment the gate went live, every failure the balance-exhausted fallback. Fixed with a one-time, per-subscription, idempotent migration (`balanceMigratedAt`, `scripts/prod-start.mjs`, runs every boot like the existing WhatsApp-number-routing reconciliation) that grants a configurable starting balance (`migration_grant_messages_kes`/`migration_grant_ai_kes`, defaults 500/250 KES) to any real non-trial, non-Enterprise subscription that predates the gate — never re-granted to a subscription that later legitimately runs its balance to 0 through real usage.
- **Still open, not yet built**: low-balance notifications (dashboard + bundled SMS), the top-up flow (M-Pesa, targeting a specific balance), the `/onboard` flow changes (remove card-on-file, trial-first with no plan selection, one-trial-per-phone via the existing `OtpChallenge` table, admin override for legitimate re-signups), and admin UI for the new configurable settings.

---

## Historical findings (2026-08-23 formal audit + earlier), current status re-verified against code today

*Compiled by an agent that read the complete `docs/OPERATIONS-GUIDE-2026-08-23.md` (all ~70 sections) and independently re-checked every claim against the current source tree — not copied from the guide's original notes, which in several cases were already stale (an item marked "deferred" in one section had actually been fixed several sections later, with no cross-reference back).*

### SECURITY

**Still open:**

1. **RESOLVED, 2026-08-24 — tenant-scoping ORM extension now fails CLOSED.** Root cause found, fixed, deployed warn-only first, watched real production traffic for ~8 minutes with zero `[TENANT-CONTEXT-MISSING]` hits, then flipped `db.ts` back to a real throw (`TenantContextMissingError`) — re-verified the same way as the warn-only deploy (rebuilt with the throw active, full click-through as a real tenant and the real super admin under `next start`, zero failures) before shipping the flip itself. The original 2026-08-23 write-up blamed "React Server Component page renders don't propagate AsyncLocalStorage" — that theory was wrong. 2026-08-24: reproduced the real failure directly against a genuine `next build && next start` (the prior fix was only ever verified under `next dev`, which hides this): the actual mechanism is that `enterTenantContext()`/`enterCrossTenantContext()` called INSIDE a nested async guard function (`requireTenantUser()`, `assertAdminPermission()`) and then RETURNING a value for the caller to keep using does not survive — the context is lost the instant that function returns, even one line later, even in Route Handlers (not RSC-specific at all). What reliably survives, proven the same way: set context, then synchronously invoke a callback in the same frame — even across further awaits, even across module boundaries, even read back from db.ts's own extension.
   Fix shipped: three new wrapper functions (`withTenantUser` in `auth.ts`; `withAdminPermission`/`withAssertAdminPermission`/`withAnyAdmin` in `admin-authz.ts`) that set context and invoke the caller's remaining logic as a callback instead of returning a value. Converted every real call site across the dashboard (`actions.ts`'s 29 functions, every `dashboard/**` page/layout), admin (`admin-actions.ts` and 5 other `*-actions.ts` files, every `admin/**` page/layout), and two files that fell through the initial scoping and were only caught by a final direct sweep (`training-actions.ts` — a real gap, `Contact` writes with no context; `admin/page.tsx` — the admin overview page had NO permission-specific guard at all, relying solely on the layout, which is exactly the broken propagation case). Verified via direct reproduction: rebuilt with a temporary hard-throw in place of the warn, ran a full click-through as a real tenant and as the real seeded super admin across every dashboard and admin page under `next start` — zero context-missing errors, versus a hard 500 before the fix. Full regression suite clean (73/74, same pre-existing quota-exhaustion failure as always).
   `db.ts` now throws `TenantContextMissingError` for real (no longer warn-only) — a query on a tenant-scoped model with no context established, and no explicit cross-tenant marker, is a hard error again. Left numbered as item 1 here rather than renumbering the whole list; treat "RESOLVED" at the top of this entry as the actual status.
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

The most consequential item on this whole list, **the tenant-scoping fail-open default** (security section, item 1), is now fully resolved as of 2026-08-24 — root cause found, real fix shipped, and `db.ts` flipped back to fail-closed after a clean production observation window. The two money-billing gaps found in the same round that started this whole register — **subscription cancellation** (item 3) and **plan changes** (item 4) — are both resolved as of 2026-08-24/25 too, each shipped only after working through a real design trap (unbounded cost exposure from an unpaid cancellation; retroactive billing from an un-prorated mid-cycle plan change) rather than building the obvious-looking version first. Until Meta's review clears, **Business Verification** (item 2, now submitted and pending) is the remaining item with real external dependency. Everything else still open is real but lower-severity — either a genuine, deliberately-scoped-later feature gap, or a deliberate product decision correctly not mistaken for a bug.

The pattern behind today's incident — a missing database-level constraint letting bad state exist that application code alone should have prevented — is worth watching for specifically when reviewing any future *new* channel/connector/external-identity feature: does the schema itself enforce the invariant, or only a code path that could be bypassed by a second code path nobody thought to check.
