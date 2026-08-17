# P2Less — Architecture & Spec Coverage

This document describes the architecture as built, the security model, and an
honest map of every major spec requirement to its status: **Built** (working +
tested), **Scaffolded** (data model / interfaces / extension points in place,
partial implementation), or **Roadmap** (designed for, not yet implemented).

The guiding rule from the brief is honored: *design for the full vision, implement
a strong MVP, and never fake functionality.* Where something is not fully built,
it is marked below — not hidden behind a placeholder that only looks functional.

---

## 0. The routing principle

P2Less sits **behind an organization's own WhatsApp number**. The user messages
that number; P2Less is invisible. The **destination number is the routing key**:

```
+254711562526 → Hamzone Technologies → tenant → Payroll API
+254711000001 → Riverside Academy    → tenant → School API
+254711000002 → Nairobi Hospital     → tenant → Patient API
+254711000003 → Kilimani Retail      → tenant → Orders API
```

The WhatsApp webhook resolves the Cloud-API `phone_number_id` → `WhatsAppNumber`
→ tenant; the web-chat simulator resolves the number directly. One platform, many
numbers, isolated data. Replies are sent **as the organization**, never as P2Less.
An organization may own several numbers (General, HR, Finance…), each with its own
capabilities and branding.

## 1. Layered architecture

```
                         ┌─────────────────────────────┐
   Entry                 │ ORG WhatsApp number (webhook) │  routed by phone_number_id
                         └──────────────┬──────────────┘
   Channels              │ web chat · WhatsApp · SMS    │   src/app/api/channels/*
                         └──────────────┬──────────────┘
                                        │  (thin adapters, no business logic)
                         ┌──────────────▼──────────────┐
   Conversation engine   │ orchestrator pipeline        │   src/lib/conversation.ts
                         │  identity → intent → authz    │
                         │  → OTP → confirm → execute    │
                         └───┬───────────┬───────────┬──┘
              intent (AI)    │           │           │   authz + OTP
         src/lib/ai.ts ──────┘           │           └────── src/lib/{permissions,otp}.ts
         src/lib/intent-engine.ts        │
                         ┌───────────────▼─────────────┐
   Integration layer     │ connector engine            │   src/lib/connector-engine.ts
                         │  auth inject · timeout/retry  │
                         │  · response mapping           │
                         └───────────────┬─────────────┘
                                         │  real HTTP + credentials
                         ┌───────────────▼─────────────┐
   External systems      │ organization's own software │   (demo: /api/demo-school/*)
                         └─────────────────────────────┘

   Cross-cutting: multi-tenancy · audit · usage metering · documents · billing
```

## 2. Data model (`prisma/schema.prisma`)

- **Tenancy & billing:** `Tenant`, `Plan`, `Subscription`. Every tenant-owned row
  carries `tenantId`; all queries are tenant-scoped in the app layer. In
  production this is backed by Postgres Row-Level Security on the same columns.
- **Identity & access:** `User` + `Role` + `UserRole` (dashboard staff, RBAC);
  `Contact` + `ContactRole` (conversational end users). A `Contact.grants` JSON is
  the authorization ground truth of which external records a contact may access.
- **Number registry:** `WhatsAppNumber` — the routing backbone. Each row is an
  organization number (globally unique `phoneNumber`, Cloud-API `phoneNumberId`,
  `displayName` shown to users, per-number branding). Inbound messages route on it.
  Multiple numbers per tenant are supported.
- **Channels:** `Channel` (transport type: webchat/SMS…).
- **Connectors:** `Connector` (system + encrypted auth) → `ConnectorAction`
  (endpoint + params + response mapping + permission + resource guard + step-up +
  sample phrases + reply template). `kind` allows GraphQL/SOAP/DB connectors to
  slot in without migration.
- **Conversation:** `Conversation` (status machine + JSON memory) + `Message`.
- **Auth:** `OtpChallenge` (hashed, expiring, rate-limited) + `AuthSession`.
- **Governance:** `AuditLog` (redacted), `UsageEvent` (metering), `Document`
  (secure temporary delivery), `SupportTicket` (human escalation).
- **Developer platform:** `ApiKey`, `Webhook`.
- **Demo external system:** `DemoStudent`, `DemoResult`, `DemoFeeAccount`,
  `DemoAttendance`, `DemoAnnouncement`, `DemoTimetableSlot` — a stand-in for a
  third-party school system, reachable only over HTTP.

## 3. Security model

- **Credential encryption at rest** — AES-256-GCM (`crypto.ts`); decrypted only in
  the engine at call time; never returned to clients or logged.
- **OTP step-up** — codes hashed at rest, 5-min expiry, max-attempt lockout,
  single-use, issuance rate-limited; success mints a short verified session.
- **RBAC + resource-level authorization** — permission check *and* an IDOR guard:
  the target record id must be in the contact's grants for that resource type.
  (Tested: a parent cannot resolve another parent's child; an unlinked user is
  denied.)
- **Controlled AI** — the model chooses only from configured, permission-gated
  actions; its output is re-validated against the allowed set. No free SQL, no
  arbitrary URLs, no direct DB access.
- **Tenant isolation** — every query scoped by `tenantId` (tested at the data
  layer).
- **Audit redaction** — keys matching `password|secret|token|apikey|otp|pin|…`
  are redacted; long values truncated. (Tested: credentials never appear.)
- **Secure documents** — unguessable token URLs that expire (30 min).
- **Honest failure** — external errors surface as "system unavailable", never a
  fabricated answer (tested, including recovery).

## 4. Spec coverage map

### Built (working + covered by `npm test` or exercised in-app)
- **Number → tenant routing** via a `WhatsAppNumber` registry (multiple numbers
  per org); replies sent as the organization identity, not P2Less
- **Four demo organizations** (school, payroll/HR, hospital, retail), each behind
  its own number + tenant + separately-hosted external system; routing + isolation
  proven across all four
- **Generic resource resolution** from authorization grants — students, employees,
  patients, orders, members — with name match, memory, and self-service defaults
- Multi-tenant data model + tenant isolation
- RBAC + resource-level authorization (IDOR guard)
- Connector framework (REST) — auth injection, timeout, retry, response mapping
- No-code Connector Builder (Dashboard → Integrations → New connector)
- Conversation engine: intent, entities, ambiguity clarification, memory, greetings
- **Multi-step slot filling** (collect missing params one by one, e.g. date → time)
- Deterministic intent engine **and** Claude adapter (constrained to actions)
- OTP step-up authentication (+ verified sessions, rate limits)
- **Read AND write operations** — write actions gather params, echo a confirmation,
  execute a real POST to the external system on CONFIRM, and persist (appointment
  booking; cancellation aborts). All covered by `npm test`.
- Document generation + secure, expiring delivery (report card)
- Web-chat channel (WhatsApp-style) + WhatsApp webhook adapter (same engine)
- Organization dashboard (overview, integrations, conversations, audit, users)
- Super-admin (tenants, plans, platform usage)
- Subscription plans (configurable, not hard-coded) + usage metering + limit checks
- Audit logs with redaction · human escalation (support tickets)
- White-label branding (assistant name, colors, welcome, PDF footer — per tenant)
- Demo school integration as a real, separately-hosted HTTP system

### Scaffolded (model/interfaces/extension points present; implementation partial)
- **WhatsApp outbound send:** the webhook parses real Cloud-API payloads and
  routes inbound by `phone_number_id` → tenant; **outbound** delivery is simulated
  (logged) pending provider credentials — the only WhatsApp-specific TODO, isolated
  to `transport.ts::deliver()` (implement the Graph API POST there). SMS/Telegram
  are the same shape. Number onboarding/verification is a registry write + the
  provider's own verification flow.
- **Developer platform:** `ApiKey` + `Webhook` models exist; issuance UI, the
  public P2Less API surface, and webhook signing/delivery are next.
- **Connector kinds:** `rest` implemented; `graphql | soap | database | custom`
  are modeled and dispatch on `kind` (engine currently handles REST).
- **Documents:** HTML generated + delivered via expiring token; PDF rendering +
  object storage is the production swap (interface unchanged).
- **AI:** Claude wired for intent; briefings/summaries/NL-workflow are roadmap.

### Roadmap (designed for; not implemented in this MVP)
- Integration Marketplace (publish/install connectors)
- Visual workflow builder + long-running multi-step workflow persistence
- OAuth 2.0 / JWT refresh flows for connectors (auth types are modeled)
- Proactive notification scheduling & preferences (usage/audit plumbing exists)
- Full observability stack (metrics/traces/alerting) beyond audit + health
- Enterprise SSO, on-prem deployment, usage-based billing invoicing

## 5. Production notes

- **Database:** change `datasource.provider` to `postgresql`, set `DATABASE_URL`,
  add RLS policies keyed on `tenantId`. Models are portable (enum-like fields are
  strings by design).
- **Secrets:** `CREDENTIAL_KEY` (32-byte base64) and `AUTH_SECRET` must be real,
  rotated secrets. The engine supports per-connector credential rotation by
  re-encrypting `authConfigEnc`.
- **Async work:** WhatsApp sends, PDF generation, notifications and webhooks
  should move to a queue; `transport.ts` and `documents.ts` are the seams.
- **WhatsApp:** set the tenant's `Channel.address` to the Cloud-API
  `phone_number_id`, implement the Graph send in `transport.ts::deliver()`, and
  set `WHATSAPP_VERIFY_TOKEN`.
