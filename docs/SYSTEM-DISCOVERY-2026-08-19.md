# P2Less — Complete System Discovery & Architecture Review

**Date:** 2026-08-19 · **Method:** direct code investigation (4 parallel deep-reads of the actual codebase, cross-checked against `docs/ARCHITECTURE.md`/`README.md`'s stated original intent — several claims in those docs are now stale and are flagged explicitly below). Every finding below is anchored to a file and, where practical, a line number. Nothing here is proposed or aspirational unless explicitly labeled **Recommended** or **Future/Strategic**.

---

## 1. What Is P2Less Actually?

**P2Less is a multi-tenant conversational access & integration platform**, not a chatbot. The precise mechanism, confirmed in code (`src/lib/conversation.ts`, `src/app/api/channels/whatsapp/webhook/route.ts`):

An organization connects **its own** WhatsApp number to P2Less. P2Less becomes invisible infrastructure sitting *behind* that number — it never presents itself as "P2Less" to anyone. When a user messages the organization's number, the Cloud API webhook routes by **destination `phone_number_id`** (not sender) to a `Tenant`, resolves the sender to a `Contact` scoped to that tenant, runs one shared pipeline (identity → intent → resource resolution → authorization → OTP step-up → confirm → execute against the organization's own backend through a **Connector** → reply as the organization), and the reply is delivered back **as the organization's own identity**.

So: **a multi-tenant AI automation platform for organizations that already have systems of record, delivered through the WhatsApp number their people already use.** It is not primarily an "AI service" (the AI is one component — see §5) and not a generic SaaS dashboard (the dashboard is administrative surface over a conversational product; the actual product is what happens when someone messages the org's number).

- **Problem solved:** organizations (schools, hospitals, SACCOs, retailers, payroll/HR departments...) have back-office systems their staff/customers/members need info from or actions on, but making everyone install an app or log into a portal is friction. P2Less lets them ask over WhatsApp instead.
- **Who for:** two audiences simultaneously — (a) the organization (buys a plan, configures connectors, gets a WhatsApp-native front door to its own systems) and (b) that organization's own end-users (parents, patients, employees, customers) who never sign up for anything, they just message a number they already have saved or find.
- **Why WhatsApp:** zero-install distribution to populations that already use it universally in Kenya/East Africa (the demo tenants — a school, a hospital, an HR/payroll shop, a retailer — reflect this).
- **Why an org would pay:** it replaces "build our own chatbot + backend integration + auth + billing metering" with configuration (a Connector Builder, no code) plus P2Less's shared infrastructure (billing, RBAC, incident detection, support tooling).
- **What makes it different from "just building a WhatsApp bot":** the multi-tenant routing-by-number architecture, the constrained/authorized AI (the model can only pick from the tenant's own configured, permission-gated actions — never free-form tool use), the connector engine as a reusable no-code integration layer, and — as of this session — a genuinely operational SaaS substrate (real billing lifecycle, real AI cost accounting, RBAC, incident detection, a support/ops centre) sitting under all of it.
- **Value to P2Less the operator:** subscription revenue (`Plan`/`Subscription`/`Payment`) plus a real, if partial, cost/margin model (§6, §11) to understand whether that revenue is profitable per-tenant.

**What the existing implementation indicates P2Less is intended to become:** a genuine multi-tenant SaaS platform with real operational maturity — not just working conversational infrastructure but the surrounding machinery (billing automation, security/RBAC, incident detection, customer operations) that a company actually running this as a business needs. The five completed priorities (AI cost accounting, automated billing, RBAC, integrations/system health, customer ops) are explicitly *the SaaS operational layer*, built after the conversational core — confirming the product's own trajectory is "conversational core first, business/operational maturity second," and that trajectory is substantially executed already.

---

## 2. Who Are the Existing Users?

**Platform-level (super_admin, finance_admin, operations_admin, support_admin, security_admin, read_only_admin)** — real, code-enforced, not aspirational. 29 fine-grained permissions (`src/lib/admin-permissions.ts`), each role a genuinely different slice (finance can refund/edit pricing but not touch integrations; security can rotate credentials and toggle maintenance but not billing; support owns the full ticket lifecycle). Custom roles are also supported (`AdminRole.isBuiltIn=false`).

**Organization/tenant-level users** — the seeded demo tenants span exactly the industry breadth implied: a school (Riverside Academy), a payroll/HR company (Hamzone Technologies), a hospital (Nairobi Hospital), a retailer (Kilimani Retail). `Tenant.industry` is a free string with observed values `school | hospital | sacco | business | ngo | government | ...` — the model doesn't hard-code a fixed industry list, meaning the architecture is deliberately industry-agnostic, only the demo data is narrow. Tenant staff roles: `owner`, `admin`, `integration_manager`, `staff` (`src/lib/permissions.ts`), stored per-tenant as editable DB rows (`Role`), not a fixed code catalog — an org can define its own permission sets.

**End users (`Contact`)** — the people actually texting the org's number. No account/signup; identified by phone number scoped to `(tenantId, channelType, address)`, authorized via `Contact.grants` (a JSON map of which external-system record ids they may access — the actual authorization ground truth, e.g. `{students: ["STU-014"]}`), optionally OTP-verified for sensitive reads. **Contact and User are structurally separate models with no relation between them** — a clean boundary.

**The stated workflow is confirmed exactly as described in the prompt**, verified end-to-end in `conversation.ts`'s `handleInbound()`: number→tenant routing → identity → intent → authz/resource-grant check → OTP step-up where required → confirm (for writes) → connector execution → response → audit + usage metering. This is real, not aspirational — it's the actual, single, channel-agnostic pipeline both WhatsApp and the web-chat demo call.

**One real gap in the "who are the users" model:** platform admins and tenant staff are **the same `User` table**, distinguished only by whether `tenantId`/`adminRoleId` happen to be set — nothing in the schema or the role-assignment action (`assignAdminRoleAction`) actually prevents a user from having both simultaneously. Not a confirmed live bug, but a soft point in an otherwise clean three-tier identity model (see §13).

---

## 3. What Does WhatsApp Actually Do?

**Onboarding is real but incomplete.** `src/app/onboard` presents a self-service "Connect with Meta (Embedded Signup)" form; the actual Meta OAuth handshake is honestly stubbed — the code and the UI copy both say so (`provisionOrganizationAction`, `src/lib/actions.ts:107-162`; onboard UI copy: *"In this demo that step is stubbed"*). What's real: a `WhatsAppNumber` row is created with `verificationStatus:"pending"`. The only path that makes a number actually receive live traffic is a manual script (`scripts/connect-number.ts`), run by an operator with real Meta-issued credentials. One tenant can own multiple numbers (schema has no unique constraint forcing 1:1) — confirmed via `/dashboard/numbers`, but `connect-number.ts` itself has a bug where it always updates only the *first* number found on re-run, so it can't be used to *add* a second number to an existing tenant (only fresh `db.whatsAppNumber.create` calls can).

**Inbound lifecycle — real, matches the textbook flow closely, with two named gaps:**
```
Meta → webhook (HMAC-verified if WHATSAPP_APP_SECRET set) → 200 ACK immediately → background processing
  → phone_number_id → WhatsAppNumber → Tenant
  → Contact/Conversation resolve → InboundEvent idempotency record (monitoring only)
  → in-memory wamid Set dedup (the REAL dedup gate — process-local, lost on restart/scale-out)
  → handleInbound() → understand → resource resolution → authz → OTP → execute → reply
  → transport.deliver() (real Graph API POST) → Message row → usage metering → AiRequestLog
```
Two specific, real gaps: (1) the actual duplicate-suppression mechanism is an in-memory `Set` capped at 1000 entries, not the persisted `InboundEvent` — a horizontally-scaled or restarted server loses it; (2) if a number's access token silently expires/is revoked, nothing detects it — `checkWhatsAppHealth()` only checks "was there recent message activity," never a live token-validity probe, so a number can silently stop being able to send with zero operator-visible signal beyond raw logs.

**Capabilities matrix (from the traced pipeline, not assumption):**

| Capability | Status |
|---|---|
| Ask for information / request account data (grades, fees, appointments, payslips) | **Existing** — the core connector-read path |
| Request documents (report cards, payslips, receipts, statements) | **Existing** — real PDF generation + secure token delivery |
| Make payments (M-Pesa STK) | **Existing** — real Daraja calls |
| Check status (order, application, appointment) | **Existing** |
| Request human support | **Existing** (ticket created) but **Partial** on the "someone will get back to you" promise — see §15, no notification actually fires |
| Receive proactive notifications | **Missing** — no scheduled/proactive outbound messaging found (billing reminders are computed but delivery mechanism not confirmed to reach WhatsApp specifically — see §9/§16) |
| Trigger business writes (book/cancel/order) | **Existing** — full multi-step slot-filling + confirm-before-execute |
| General AI small talk / off-topic handling | **Existing**, grounded (never invents facts, falls back to org FAQs) |
| Voice notes | **Existing** (inbound transcription via Gemini) — outbound voice **Missing** |
| Buy products via a catalog | **Existing** — full commerce flow (options, delivery vs pickup, address capture, driver dispatch) |

---

## 4. How Does the Existing Conversation System Work?

Answered in depth by the investigation; summary: identity/tenant/user resolution is solid and tenant-scoped throughout. **10 prior turns** of real message history are fed to every AI call that needs context. Conversation "memory" is not raw chat history but a typed structured-state object (`ConvContext`) tracking exactly what the pipeline is mid-way through — **15 distinct `awaiting_*`/pending states** are handled (OTP, confirm, resource-pick, param slot-fill, self-service identify, CV-builder, 6 separate commerce-order sub-states, delivery feedback, escalated). Ambiguity → numbered disambiguation list, explicitly engineered against a documented prior bug (infinite-repeat). Unknown intent → grounded small talk, never a bare "I don't understand." Unavailable operations → an honest "not available" message, never a fabricated success. The channel-agnostic claim is **confirmed true** — WhatsApp and the web demo call the exact same `handleInbound()`.

**One real gap:** there is no conversation-level duplicate-*content* suppression — if a user sends the same text twice as two genuinely distinct WhatsApp messages, both are processed independently (dedup only guards against Meta *redelivering the same message*, not a user *repeating themselves*, which is arguably correct behavior anyway — flagging it because the user's original prompt asked specifically about this).

**Is the architecture strong enough for what P2Less is trying to become?** Yes, for the current single-turn/task-oriented use case — it's a genuinely sophisticated state machine with real anti-nag, anti-repeat, and anti-hallucination engineering baked in from documented real production bug reports (visible in the memory record of this project's own history). The one place it would need to grow: multi-agent or long-running/asynchronous workflows (the roadmap in `docs/ARCHITECTURE.md` itself flags "visual workflow builder + long-running multi-step workflow persistence" as not implemented) — today everything is a single request/response turn or a short slot-filling sequence, never a durable background workflow initiated by the AI itself.

---

## 5. What Is the Existing AI Architecture?

**7 real providers wired** (Gemini, Groq, Cerebras, OpenRouter, Anthropic, OpenAI, xAI) — this directly **contradicts** the stale `docs/ARCHITECTURE.md` claim of "Claude wired for intent, no other providers." Real sequential multi-provider failover (`callLLM()`): each provider retried twice with backoff, then the chain moves to the next configured provider; disabled-via-admin providers (`Integration.enabled=false`) are excluded from the chain, not just hidden in UI. Every fallover event that lands on a non-primary provider (or exhausts the whole chain) writes a genuine audited `AuditLog` row (`ai.provider_failover`).

**7 distinct AI operations**, each with a specific job: `understand` (intent routing, constrained to the tenant's configured actions only), `classifyCommerceMessage` (shopping intent, grounded to real product list), `resolveOrderStepAnswer` (free-text order-flow slot resolution), `humanizeReply` (rephrase already-fetched real data — cannot invent facts), `smallTalk` (grounded off-topic handler), `complete` (general use — greeting variation, tool calls), `transcribeAudio` (voice notes, Gemini-only).

**Real, traced AI-call count per message** — this matters for cost/latency reasoning: a typical non-commerce data-lookup message costs **2 sequential AI calls** (`understand` → `humanizeReply`, the second depending on real data fetched between them). A commerce-tenant hit on the fast classifier path costs **1 call**; a commerce-tenant miss can cost **up to 3**. A pure greeting costs 1. This is real, useful operational knowledge that isn't documented anywhere else in the codebase.

**Non-AI deterministic fallback is real and complete** — `intent-engine.ts`'s fuzzy/Levenshtein matcher operates the entire platform with zero AI keys configured, by explicit design (confirmed: `aiEnabled()` gates every AI export, and every AI export has a deterministic-degrade path).

---

## 6. How Does the Existing AI Economics System Work?

**Accurate at the per-call level, genuinely versioned, but split across two disconnected views at the reporting level.**

Per successful call: `AiRequestLog` records tenant/feature/provider/model/tokens/costUsd/costKes/**revenueKes**/success. Cost is computed from a real, versioned per-token-price table (`ModelPricing`, new price = new row, historical costs never silently rewritten) — **if a model has no pricing row, cost is honestly `0`, visible as an amber "not priced" badge on `/admin/models`**, not silently absorbed. Every attempt (not just the successful one) is separately logged to `AiCallEvent` for failure-rate/latency analysis, but **only the successful attempt is ever costed** — retries and failed fallback attempts cost nothing, correctly.

**The real inconsistency:** `revenueKes` is populated on every call, but from a single flat platform-wide `PlatformSetting` (`price_ai_kes`, default KES 1/request) — **not** tied to the tenant's actual plan/contract, not per-token, not reconciled against the tenant's real monthly `Subscription`/`Payment` billing. So "AI request revenue" and "what the tenant is actually being charged" are two separate numbers that happen to share a name. Additionally, `/admin/ai`'s "estimated spend" tile uses a *different*, flat, admin-set `costPerCallKes` per provider (ignoring real token data even when it exists), while `/admin/models` shows the more accurate real per-token cost — **an admin can see two different cost figures for the same provider on two different pages**, and if `costPerCallKes` is never set for a provider, `/admin/ai` silently shows KES 0 spend for it while `/admin/models` shows the real (nonzero) figure.

**Verdict: Partial.** The underlying data (real tokens, real versioned pricing, per-attempt tracing) is accurate enough to *support* real financial reporting — the reporting layer itself (the two disconnected cost views, and the flat non-per-tenant revenue assumption) is not yet trustworthy for profitability analysis without reconciliation.

---

## 7. What Is the Existing Tenant Architecture?

26 models carry `tenantId`; ~21 platform-global models (settings, pricing, integrations, incidents, jobs, admin RBAC, plans) do not — a clean, confirmed-exhaustive split (see full model inventory in §17). **Isolation is 100% application-layer** — the schema's own header comment states Postgres RLS is a stated *production plan*, not implemented; on today's SQLite datasource RLS isn't even possible. Every isolation guarantee depends on every query remembering to filter by `tenantId`. A spot-check across both Priority-5-era and long-standing code (5 checks in one agent, 5 in another, 10 total) found **zero confirmed leaks**, but also confirmed there is **no structural backstop** (no Prisma middleware, no query wrapper, no DB constraint) that would catch a missing `tenantId` filter if one were ever written — the safety today is entirely "every developer remembered."

Tenant creation is genuinely self-service via `/onboard` (not just `prisma/seed.ts`) — but that flow always provisions the free/trial plan with no plan-selection UI and no payment collection before or during tenant creation (see §8).

---

## 8. What Is the Existing Customer Onboarding Workflow?

**Real, but shorter than the textbook flow.** `/onboard` → `provisionOrganizationAction` → one transaction creates Tenant(`trial`), auto-assigned `free` Plan, Subscription(`trial`), default roles, owner User (system-generated one-time password shown once, no confirmed email delivery), and a `WhatsAppNumber` row (`pending`). **No plan-selection step, no payment collection, no "testing" step before "go live," and the WhatsApp connection step is honestly stubbed** (real activation requires the manual `connect-number.ts` script with real Meta credentials). So: automated (tenant creation itself), but the real productization gaps are plan selection, payment-gated signup, and self-service WhatsApp activation.

---

## 9. What Is the Existing Subscription Lifecycle?

All 6 declared `Subscription.status` values are used **except `cancelled`**, which is declared in the schema comment but has **no writer anywhere in `src/lib`** — a dead/unreachable state today (no cancel flow exists). Real transitions confirmed: `trial→active` (payment), `active→renewal_due→payment_pending→active` (renewal cycle), any→`grace_period` (retries exhausted)→`suspended` (grace expires)→`active` (payment). All timing (grace period days, retry count/interval, whether auto-suspend is even on) is runtime-configurable via `PlatformSetting`, not hardcoded. Scheduling is genuinely automated via a real background poller (`billing_poller`, 15-min interval, started from `instrumentation.ts` on process boot) — not admin-click-driven, though an admin can force a run. **A real, deliberate safety net**: a tenant with an unresolved "unknown" payment is explicitly skipped from *any* further billing progression (`if (sub.reconciliationNeeded) continue;`) — confirmed this is not just a Subscription-level flag but derived live from Payment-level state.

---

## 10. What Payment Systems Already Exist?

| Channel | Status |
|---|---|
| M-Pesa STK Push | **Existing** — real Daraja OAuth + push + callback, with an honest mock fallback when unconfigured |
| M-Pesa PayBill/Till (C2B) | **Partial** — real, correctly Daraja-shaped confirmation/validation endpoints exist, but genuinely un-verifiable against live Safaricom traffic in this environment (requires an external URL-registration step); the code's own comment says so |
| Bank transfer | **Partial, and mislabeled** — marked `implemented:true` in the catalog, but the only "implementation" is a manual admin form creating an `UnmatchedTransaction` row; there is no programmatic bank API integration anywhere. This is functionally identical to Card's honesty-labeled `implemented:false` and should arguably carry the same label. |
| Card | **Missing**, honestly labeled `implemented:false`, never faked as available |

**Reconciliation model is genuinely well-designed**: `Payment.status="unknown"` (not a boolean failure) with a real categorized `failureCategory` (9 categories, text-matched from Safaricom's own error text, not a brittle numeric-code table), a documented safety interaction with billing suspension, and a mandatory-reason admin resolve action. **One real, specific gap found:** the STK callback route only processes a webhook when the payment is still `status:"pending"` — once the reconciliation sweep has already flipped it to `"unknown"`, a genuinely late-but-real Daraja callback arriving afterward is silently ignored rather than auto-resolving the payment; only a human via the admin reconcile action can close it out. This is a real, fixable, narrow gap, not a fundamental design flaw.

---

## 11. How Do Plans and Pricing Currently Work?

4 real plans (free/professional/business/enterprise) with editable price/limits/features, admin-editable with full before/after audit trail. **Margin computation is real at two levels** (not just an aspiration): `computeBill()` computes a genuine per-tenant margin from **real metered usage** × admin-set unit-cost assumptions; `computePlatformPnL()` computes platform-wide P&L and **prefers real per-token AI cost data** over the flat estimate once any exists for the month. The one permanent estimate (not swappable for a real figure, because the provider doesn't expose one): WhatsApp/Meta per-conversation cost and document-generation compute cost — both admin-set constants, since Meta has no live billing API at the tier P2Less uses. **Verdict: the system CAN determine tenant profitability today**, with AI cost being real and WhatsApp/document cost being a considered, transparent estimate rather than a guess.

---

## 12. How Is Usage Currently Measured?

6 declared usage types, all genuinely metered somewhere in the real request path (`message_in`, `message_out`, `ai_request`, `api_call`, `document`, `tool_run`). **Enforcement is the real gap**: `checkLimit()` exists and supports all the plan-limit fields, but is only ever *called* from one place in the entire codebase — `message_in`, right before a message is recorded. Every other declared limit (`ai_request`, `document`, and `connectors`/`users` which aren't even wired into the limit-type map at all) is metered but **never enforced** — a tenant can exceed their AI-request or document-generation allowance indefinitely with no block, warning, or even a flag. This is a genuine, specific, fixable gap, not a design absence (the machinery exists, it's just not wired everywhere it's declared to apply).

---

## 13. How Secure Is the Existing System?

Two cleanly-separated **permission catalogs** (platform-admin RBAC, code-defined and fine-grained; tenant-staff roles, per-tenant DB data) with no string collision and enforced by different gate functions. Three identity mechanisms (dashboard/admin JWT+DB-session, contact OTP+session, developer API keys) — genuinely real, DB-backed session revocation (not just cookie deletion) confirmed working. Tenant-scoping spot-checked across 10 real Server Actions/routes with zero confirmed leaks.

**Real findings, not hypothetical:**
- **Platform admins and tenant staff share one `User` table** with no structural guarantee against a single row having both `tenantId` and `adminRoleId` set — a soft gap in an otherwise clean 3-tier identity model, not a confirmed exploit.
- **Audit redaction is inconsistent**: the tenant-facing `AuditLog` writer (`audit()`) always sanitizes sensitive-looking keys before writing; the platform-admin-facing `PlatformAuditLog` writer (`logPrivilegedAction()`) — which receives the same kind of `detail`/`previousState`/`newState` payloads, including credential-related actions — **never sanitizes**. This is a real, specific, fixable gap.
- **No brute-force lockout on login** — `LoginAttempt` is logged and displayed to admins, but `loginAction` never consults its own history; an attacker can attempt unlimited password guesses against any known email.
- **No general API rate limiting anywhere** — no `middleware.ts`, no edge/global throttle, and the developer API (`/api/v1/*`) checks auth+scope only, never request volume.
- **No fraud/abuse-detection code exists anywhere** in the codebase (confirmed via exhaustive grep) — this is an honest absence, not a hidden partial implementation.
- OTP-specific abuse protection **does** exist and is real (issuance rate limit, verification attempt cap, single-use, hashed-at-rest).

**Can Tenant A reach Tenant B's data through any path?** No confirmed path found in this audit's sampling, but the guarantee rests entirely on every developer remembering to scope every query — there is no structural backstop (Prisma middleware, RLS, or otherwise) that would catch a mistake before it shipped.

---

## 14. What Does the Existing Admin System Already Provide?

Full page-by-page inventory is in the underlying investigation; headline: **17 distinct `/admin/*` areas**, every one backed by real data and a specific `AdminPermission` gate (only `/admin/settings` and the `/admin` overview itself lack a specific permission beyond "is any kind of admin"). Every area connects to real tables, not placeholder data — confirmed by the same investigation that built most of Priorities 3-5 this session, cross-checked independently by the audit agents. No area was found to be cosmetic/non-functional.

---

## 15. What Does the Existing Customer Operations Centre Actually Do?

All the lifecycle capabilities described in the prompt are **real and confirmed working** (assign, internal notes vs customer-visible responses as one interleaved stream, attachments, link payment/incident, resolve-with-reason, reopen, SLA breach detection) — this was extensively live-verified with real sessions earlier this session, and independently re-confirmed by direct code read just now.

**Two real, specific gaps surfaced by this fresh, independent audit that are worth being honest about:**
1. **Ticket support is entirely platform-admin-facing.** `src/app/dashboard` has no ticket/support area at all — a tenant's own staff cannot see or respond to their own organization's support tickets today. All ticket interaction happens in `/admin/tickets`, by P2Less's own team.
2. **"Customer-visible response" does not actually reach the customer on WhatsApp.** `addCustomerResponseAction` only writes a `TicketEvent` row and re-renders the admin page — it never calls anything in `transport.ts`. So an admin typing a reply to a customer's ticket produces something visible only inside the admin dashboard, not an outbound WhatsApp message. Combined with finding #16 below (no notification fires on ticket creation either), **the "escalate to human" loop is not actually closed end-to-end today**: a customer who asks for a human gets a ticket created and a reassuring reply, but nothing then reaches an actual human proactively, and nothing an admin later writes reaches back to the customer on the channel they used. This is the single most consequential functional gap found in this entire audit, given how central the WhatsApp-native promise is to the product.

---

## 16. What Happens When the Existing System Fails?

Failure handling is **broad, real, and mostly well-engineered** — summarized from the investigation:

| Failure | Response | Human visibility |
|---|---|---|
| WhatsApp duplicate/replay | In-memory wamid dedup, silent skip | none needed (correct) |
| WhatsApp webhook down/late | Meta's own retry semantics; 200 ACK'd immediately, processed async | — |
| AI provider down/timeout | Cross-provider failover; degrades to deterministic template if ALL fail; **user never sees silence** | audited (`ai.provider_failover`), incident opens on sustained error rate |
| STK callback never arrives | Two independent detectors (reconciliation sweep + incident check); payment marked "unknown," never silently "failed" | incident + admin evidence view |
| Background job throws | Caught, logged as a real `JobRun{status:"failed"}`, poller never dies, incident opens after N consecutive failures | `/admin/system-health`, `/admin/incidents` |
| Session revoked mid-session | Real DB-backed check on next request — genuinely kicks the user out | `/admin/security` |
| **Email/SMS notification needed** | **Nothing happens — no provider is wired at all** | none |
| **Incident detected (any of the 7 real detection paths)** | **DB row only — no email/SMS/Slack dispatch exists anywhere in the codebase** | only if a human opens `/admin/incidents` |

The last two rows are the most consequential honest gaps: the platform can *detect* almost everything that goes wrong, but it cannot *tell a human* unless that human is already looking at the dashboard. This is the same root cause as the Customer Ops finding above (§15) — **no outbound notification channel (email, SMS, or WhatsApp-to-an-admin) exists anywhere in the codebase today**, confirmed by exhaustive grep, not sampling.

---

## 17. What Does the Existing Database Actually Look Like?

Full model-by-model inventory (grouping, PKs, unique constraints, key relations) is captured in the underlying investigation — ~50+ models across tenancy/billing, identity/access, messaging, AI, payments/reconciliation, operational health/incidents, support tickets, developer platform, demo external systems, and commerce/delivery. Confirmed clean, deliberate patterns:
- **Soft references** (plain `String?` ids, no `@relation`) are used consistently and deliberately across `Incident`, `InboundEvent`, `SupportTicket`, `UnmatchedTransaction` for cross-cutting pointers between platform-wide and tenant-scoped data — a real, intentional architectural pattern, not sloppiness. One inconsistency: `SupportTicket.assignedAdminId` **is** a hard relation while `resolvedById` on the same model is soft — worth normalizing one way.
- **Confirmed likely-dead columns**: `IntegrationCredential.rotatedFromId` (the "real rotation chain" the model comment promises is never actually written by any code), `Contact.pinHash` (a PIN-based auth path that was never built — OTP is the only real step-up mechanism), `User.phone` (not set by the only user-creation path found, no read site found).
- Versioned pricing (`ModelPricing`) and encrypted-at-rest credentials (`IntegrationCredential`, `Connector.authConfigEnc`) are real, good patterns.

---

## 18. What Pages and Interfaces Already Exist?

Full URL → purpose → auth-gate table is in the underlying investigation (5 public pages, 1 auth page, 14 tenant-dashboard pages, 17 admin pages, ~30 API/webhook routes, the demo simulator). Every page's stated permission gate was verified against the actual `requireAdminPermission`/`requireTenantUser`/`withApiKey` call in the file, not inferred from the file name.

---

## 19. What APIs and Integrations Already Exist?

**Real, live integrations:** WhatsApp Cloud API (Meta Graph, full send+receive+media+typing), M-Pesa Daraja (STK+C2B), 7 AI providers. **Confirmed entirely absent, not partial:** email, SMS, and object storage (the "storage" catalog entry is a Railway attached volume, not an object-storage API). This was confirmed by exhaustive grep across the whole `src` tree, not a sampling — the only SMS-related string in the entire codebase is a catalog label ("Advanta SMS (pending)"), with zero implementation behind it.

**Webhook security is inconsistent by design, not oversight**: the WhatsApp webhook verifies Meta's HMAC signature (when configured); the three M-Pesa webhooks verify **nothing** — Daraja callbacks carry no signature to check, which is a real characteristic of that provider, not a P2Less oversight, but it does mean the `/api/payments/mpesa/*` endpoints are reachable by anyone who knows the URL and must rely entirely on idempotency + downstream business-logic validation (matching a real pending payment) rather than authentication to resist abuse.

---

## 20. Existing Gaps

Being direct, as instructed:

- **Incomplete**: WhatsApp self-service onboarding (Meta Embedded Signup is stubbed); PayBill/Till live traffic (built correctly, unverifiable without an external Safaricom registration step); tenant-facing support ticket UI (admin-only today); outbound delivery of ticket responses to WhatsApp; usage-limit enforcement beyond `message_in`; subscription cancellation (`cancelled` status has no writer).
- **Mock**: SMS transport (`transport.ts` SMS branch is a literal `console.log`); Meta Embedded Signup handshake.
- **Existing but requires improvement**: AI cost/revenue reporting (two disconnected cost views on `/admin/ai` vs `/admin/models`; flat non-per-tenant revenue assumption); audit redaction (inconsistent between `AuditLog` and `PlatformAuditLog`); STK late-callback handling once a payment is already "unknown"; bank-transfer's `implemented:true` label (should match card's honesty); `IntegrationCredential.rotatedFromId` (promised but not implemented rotation chain).
- **Missing entirely**: any outbound notification channel (email/SMS/Slack) for incidents, ticket creation, or billing reminders reaching a human proactively; brute-force login protection; general API rate limiting; fraud/abuse detection of any kind; structural (non-app-layer) tenant isolation.
- **Technical debt / dead code**: `Contact.pinHash`, `User.phone` (likely unused), `IntegrationCredential.rotatedFromId` (unused).
- **Security concerns**: shared `User` table for platform-admin and tenant-staff identities with no structural separation guarantee; unsanitized `PlatformAuditLog` detail payloads; no login lockout.
- **Scalability concerns**: the in-memory wamid dedup Set is process-local — will misbehave under horizontal scaling or frequent restarts (duplicate messages could be reprocessed).

---

## 21. What Did Our Completed Work Actually Improve?

Written from direct first-hand knowledge of building all five priorities this session, not the fresh audit (which independently corroborates the functional claims):

- **Priority 1 (AI Cost Accounting)** added `AiRequestLog`/`ModelPricing`/`AiProviderConfig` and made AI spend/revenue/margin visible per call for the first time. It's the foundation `computePlatformPnL()` (§11) and the ticket/tenant-360 AI panels (§15) both depend on.
- **Priority 2 (Automated Billing Lifecycle)** replaced what the original architecture doc implies was a simpler/manual renewal model with the real state machine in §9 — grace periods, retries, auto-suspend, all background-job-driven. It introduced `classifyOutcome()`, the "unknown ≠ failed" philosophy that every later priority (reconciliation, incidents, tickets) now depends on and reuses rather than reinventing.
- **Priority 3 (RBAC & Security)** replaced a presumably coarser earlier admin-authority model with the full `AdminRole`/`AdminPermission` system and DB-backed session revocation — every subsequent admin feature (Priorities 4 and 5) was built gated by this system from day one, not retrofitted.
- **Priority 4 (Integrations & System Health)** built the "common operational event/health model" (`Integration`, `JobDefinition`/`JobRun`, `InboundEvent`, `AiCallEvent`, `Incident`/`IncidentEvent`) that Priority 5 explicitly reused rather than duplicating (confirmed by this audit: `SupportTicket.relatedIncidentId` is a soft pointer into the SAME `Incident` table, not a parallel concept).
- **Priority 5 (Customer Operations Centre)** connected tenant/billing/AI/incident data into one investigable view (`getTenantOperationalSummary`) and gave incidents and tickets a real two-way (suggest, confirm-link) relationship.

**What remains disconnected, confirmed by this fresh audit:** the alerting gap (§16) predates all five priorities and none of them closed it — Priority 4 built excellent *detection*, Priority 5 built excellent *investigation tooling*, but neither built *notification*. This is the clearest "priorities individually excellent, but a real cross-cutting gap survived all five" finding in this whole audit. **No duplicate/conflicting architecture was found** between the five priorities — each new priority's own documentation and this independent audit agree they extended rather than replaced prior work (the "common event model" discipline held).

---

## 22–23. What Should Be Improved / What a Serious Platform Still Needs

Organized as **Existing / Planned / Recommended / Future-Strategic**, per your explicit instruction not to blur these:

| Area | Existing | Planned (docs say so) | Recommended (evidence-based, this audit) | Future/Strategic |
|---|---|---|---|---|
| Notifications reaching a human | — | — | **Close the alerting gap**: at minimum, wire ticket-creation and critical-incident-open to something that reaches an actual person (even a simple email via one provider) — this is the single highest-leverage fix found in this audit | Full preference-managed multi-channel notification system |
| Ticket → WhatsApp reply | — | — | Wire `addCustomerResponseAction` to `transport.ts` so a "customer-visible response" is genuinely delivered, not just stored | Two-way live agent handoff (a human typing live into an active conversation) |
| Tenant-facing support view | — | — | A read view under `/dashboard` so an org's own staff can see their own tickets | Tenant-side ticket creation/reply |
| Usage-limit enforcement | `message_in` only | — | Wire `checkLimit` into `ai_request`/`document` call sites already declared in `Plan.limits` | Graduated soft-warn-then-hard-block UX |
| Audit redaction consistency | `AuditLog` sanitizes | — | Apply the same `sanitize()` to `PlatformAuditLog` | — |
| Login brute-force protection | Attempts logged, not enforced | — | Consult `LoginAttempt` history in `loginAction`, add a lockout/backoff | — |
| API rate limiting | none | — | Basic per-key/per-IP throttle on `/api/v1/*` and public webhook endpoints | Full edge middleware |
| Fraud/abuse detection | none | — | — | Genuine anomaly detection (this is real future work, not a quick fix) |
| Structural tenant isolation | app-layer only | Postgres RLS (stated) | Follow through on the stated Postgres+RLS migration when moving off SQLite | — |
| Card payments | not implemented, honestly labeled | — | — | Real card processor integration |
| Bank transfer | manual-only, mislabeled `implemented:true` | — | Correct the label to match card's honesty, or build a real bank-statement-import integration | Real bank API integration |
| Cancellation flow | dead status, no writer | — | Add a real cancel path (even admin-only to start) | Self-service cancel with retention flow |
| Multi-currency / multi-country | — | — | — | Real future work |
| White-label / enterprise | `Plan.whiteLabel` flag exists, branding JSON exists | — | — | Full enterprise packaging |

---

## 24. The Complete P2Less Architecture Today

```
End User (Contact) — no account, identified by phone
       │  WhatsApp message to the ORGANIZATION'S number
       ▼
Meta Graph API
       │  webhook (HMAC-verified)
       ▼
Webhook Layer — /api/channels/whatsapp/webhook (thin adapter, no business logic)
       │  phone_number_id → WhatsAppNumber → Tenant
       ▼
Conversation Engine — src/lib/conversation.ts (channel-agnostic; webchat uses the same entrypoint)
       │  identity (Contact) → intent (AI 7-provider chain, or deterministic fallback)
       │  → resource resolution (Contact.grants) → authz (permission + IDOR guard) → OTP step-up
       ▼
Connector Engine — src/lib/connector-engine.ts
       │  real HTTP, injected encrypted per-connector credentials, timeout/retry, response mapping
       ▼
Organization's Own Systems (external — demo: /api/demo-*)
       ▲
       │  response mapped → humanized (AI) → delivered as the ORG's identity (transport.ts → Graph API)
       │
Cross-cutting, all real and wired in:
  Usage metering (UsageEvent) → Plan limits (partial enforcement)
  AI cost accounting (AiRequestLog/AiCallEvent/ModelPricing) → billing.ts P&L
  Audit (AuditLog / PlatformAuditLog)
  Documents (secure token delivery)

Tenant → Plan → Subscription → billing_poller (automated) → Payment (STK/C2B/manual)
                                                          → reconciliation_sweep → "unknown" state
                                                          → classifyOutcome() (never confuse silence with failure)

Operations layer (Priority 4/5, reads the SAME tables above, no duplication):
  Integration registry → integration_health_sweep, db_health_sweep
  incident_sweep (7 real detection paths) → Incident/IncidentEvent → [NO OUTBOUND ALERT — dashboard only]
  ticket_sla_sweep → SupportTicket/TicketEvent ⇄ Incident (soft-linked, suggest-then-confirm)
  Customer 360 (getTenantOperationalSummary) — composes everything above per tenant, read-only

Platform Admin RBAC (AdminRole/AdminPermission) gates every /admin/* action independently of
Tenant-staff RBAC (Role/UserRole, per-tenant DB data) which gates /dashboard/* actions.
```

---

## 25. What Should P2Less Become?

Starting from what's already strong, not a blank page:

**Keep and build on:** the routing-by-number architecture (it's the real differentiator and is solid), the constrained/authorized AI model (never free-form, always grounded — this is a genuine trust advantage over a naive chatbot), the connector engine's no-code extensibility, the "common operational event model" discipline that's held across 5 priorities without duplication.

**Improve before extending further:** close the alerting gap (§16) — it's the one place where excellent detection work (Priority 4) and excellent investigation tooling (Priority 5) both currently terminate at a dashboard nobody is required to be looking at. This is higher leverage than any new feature, because it's the difference between "the platform knows something is wrong" and "a human finds out in time to matter."

**Consolidate:** the two AI cost-reporting views (`/admin/ai` vs `/admin/models`); the bank-transfer honesty label; the soft-vs-hard actor-reference inconsistency on `SupportTicket`.

**Postpone (correctly, per the existing docs' own roadmap judgment):** visual workflow builder, integration marketplace, enterprise SSO — these are real future bets, not gaps in what exists today, and nothing in this audit suggests they're urgent relative to closing the notification gap.

**Competitive-advantage candidate already half-built:** the payment-channel-independent reconciliation philosophy (`classifyOutcome`, "unknown" as a first-class state, never auto-suspending on ambiguous evidence) is unusually disciplined for a platform this size — worth deliberately extending as a selling point ("we never suspend you over a payment provider's silence") rather than treating it as internal plumbing.

---

## 26. Final Assessment

**A. Product definition:** a multi-tenant conversational access & integration platform, delivered behind an organization's own WhatsApp number, now with a genuinely mature (if not fully closed-loop) SaaS operational layer underneath.

**B. Users:** 6 platform-admin roles (real RBAC), 4 tenant-staff roles (per-tenant, editable), unlimited unauthenticated-until-OTP end-user Contacts — three cleanly modeled tiers with one soft structural gap (shared `User` table for the first two).

**C. End-to-end workflow:** confirmed real and matching the textbook shape, with two real breaks in the loop — ticket-response delivery and incident/ticket alerting — both at the "reach a human" step, not earlier.

**D. Architecture:** see §24 diagram — layered, cross-cutting concerns properly separated, no found duplication between the five completed priorities.

**E. Data model:** ~50+ models, clean tenancy/global split, a deliberate and consistently-applied soft-reference convention, a handful of confirmed-dead columns.

**F. Financial model:** real per-call AI cost (versioned pricing) and real per-tenant/platform margin computation from actual usage — genuinely usable for profitability analysis, with two reporting-layer reconciliation gaps (not data gaps) named in §6.

**G. Security model:** real 3-tier identity, real DB-backed session revocation, real tenant-scoping (sampled, not exhaustively proven), zero rate-limiting/fraud-prevention/login-lockout anywhere, inconsistent audit redaction.

**H. Operational model:** 7 real incident-detection paths, 7 background jobs, real failure-degrade behavior everywhere sampled — but detection has no outbound voice; it only speaks to whoever is already looking at a dashboard.

**I. Existing vs Missing matrix:** see §22-23 table.

**J. Architectural problems:** the notification/alerting gap; two disconnected AI-cost views; shared admin/staff identity table; app-layer-only tenant isolation.

**K. Missing features:** email/SMS entirely; ticket→WhatsApp delivery; usage-limit enforcement beyond one type; real cancellation flow; brute-force/rate-limit protection.

**L. Consolidation opportunities:** `/admin/ai` vs `/admin/models` cost reporting; bank-transfer's `implemented` label vs its actual manual-only reality; actor-reference pattern (`assignedAdminId` hard vs `resolvedById` soft on the same model).

**M. Technical debt:** `Contact.pinHash`, `User.phone`, `IntegrationCredential.rotatedFromId` — all confirmed unused; `connect-number.ts`'s single-number-overwrite bug.

**N. Future opportunities:** productize the reconciliation philosophy as a customer-facing trust story; real Meta Embedded Signup for genuine self-service; multi-currency/white-label once enterprise demand is real.

**O. Improvement roadmap (sequenced by leverage, not effort):**
1. Close the alerting gap (ticket creation + critical incidents reach a real human channel) — highest leverage, smallest scope.
2. Wire ticket customer-responses to actual WhatsApp delivery — completes the support loop the product's core promise depends on.
3. Fix the two named reconciliation/consistency gaps (audit redaction, late-STK-callback-after-unknown).
4. Extend usage-limit enforcement to the already-declared, already-metered limit types.
5. Then, only then, consider net-new feature work — the existing system does not need to be rebuilt, it needs its own already-declared promises closed out first.
