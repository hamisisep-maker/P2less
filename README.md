# P2Less — Universal Conversational Access & Integration Platform

> **Stop logging into systems. Start talking to them.**
> One organization's number. One conversation. Many systems behind it.

P2Less is the infrastructure **behind an organization's own WhatsApp number** — not
a chatbot users open. A user messages the organization's number directly (nothing
new to install). P2Less sits behind that number: it routes by the **destination
number** to the right tenant, identifies the sender, authenticates them, checks
permissions, calls the organization's systems through a configured **connector**,
and replies **as the organization**. The user never sees P2Less.

```
User → Organization's WhatsApp number → P2Less → Organization's systems → back to the user
```

This repository is a **working MVP of the full architecture**: number→tenant
routing, a connector engine that makes real HTTP calls to external systems, an
intent engine, OTP step-up, resource-level authorization, multi-step write
actions, document generation, an organization dashboard, and **four demo
organizations** — each behind its own number, tenant, and separately-hosted
external system.

## Stack

- **Next.js 16** (App Router, Server Actions, Route Handlers) + **React 19** + **TypeScript**
- **Prisma** + **SQLite** (swap to `postgresql` for production; maps to RLS on `tenantId`)
- **Tailwind CSS v4**, WhatsApp-style demo UI
- **jose** JWT sessions + **bcryptjs**; **AES-256-GCM** for connector credentials
- **Claude** adapter for intent, with a deterministic fallback (**runs with no API key**)

## Run it

```bash
npm install
npx prisma generate
npx prisma db push
npm run seed             # 4 organizations, each with its own number + external system
npm run dev              # http://localhost:3000
```

Then, in a second terminal (dev server must be running):

```bash
npm test
```

## The demo: message an organization's number

Open **<http://localhost:3000/demo>**. Pick an organization to message and who you
are; the reply comes back **as the organization**. Routing is by the destination
number — message a different org and you get that org, and only what you're
authorized to see there.

| Organization number | Organization | Sender | Try |
|---|---|---|---|
| `+254711562526` | Hamzone Technologies | Amir (employee) | “Send me my payslip” (OTP) → payroll API |
| `+254711000001` | Riverside Academy | Amina (parent) | “Show me John's results” (OTP), “Book a meeting for John” |
| `+254711000002` | Nairobi Hospital | Faith (patient) | “When is my next appointment?” |
| `+254711000003` | Kilimani Retail | a customer | “Where is my order?” |

**Organization dashboards** (`/login`, password `password`): `grace@riverside.ac`,
`zainab@hamzone.io`, `admin@nairobihospital.io`, `admin@kilimaniretail.io`.
**Super admin:** `admin@p2less.io`.

## Routing + the pipeline

The WhatsApp webhook (and the web-chat simulator) resolve the **destination
number** → `WhatsAppNumber` → tenant, then run one channel-agnostic pipeline
(`src/lib/conversation.ts`):

```
inbound to ORG number → route (number → tenant) → identity (sender)
  → intent (deterministic or Claude, constrained to configured actions)
  → resolve resource from authorization grants (student/employee/patient/order…)
  → authorize (permission + resource/IDOR guard)
  → step-up (OTP) → confirm (writes)
  → CONNECTOR ENGINE → real HTTP → external system
  → response mapping → reply AS the organization → audit + metering
```

## Integrations are real, not faked

Each demo org's data lives in a **separately-hosted** external system behind its
own API key: `/api/demo-school`, `/api/demo-payroll`, `/api/demo-hospital`,
`/api/demo-business`. P2Less reaches them **only** through configured connectors
that inject each system's credentials — the same path a real third-party API
would use. Break a connector's URL and the assistant reports the system is
unavailable rather than inventing an answer (covered by the tests).

## What the tests cover (`npm test`, 33 checks)

Intent matching · **number→organization routing** (4 orgs + unknown-number
rejection) · **Hamzone payslip with OTP step-up** · leave balance ·
**tenant isolation across numbers** (the same person can't reach Hamzone payroll
via the school's number; an org lacks another org's capabilities; unknown sender
has no grant) · school reads/results-OTP/**cross-parent isolation**/ambiguity/
memory · **multi-step write (booking) → confirm → persisted** · hospital
appointment · retail order status · **honest failure + recovery when a system is
down** · data-layer tenant isolation · audit trail · **credentials never appear
in audit detail**.

## Project map

```
prisma/schema.prisma        Platform models + WhatsAppNumber registry + 4 demo external systems
prisma/seed.ts              4 tenants, numbers, connectors, capabilities, contacts, external data
src/lib/conversation.ts     Orchestrator: number routing + the pipeline above
src/lib/connector-engine.ts REST execution: auth injection, timeout/retry, response mapping
src/lib/intent-engine.ts    Deterministic NL → action matcher + entity extraction
src/lib/ai.ts               Claude adapter (constrained to configured actions) + fallback
src/lib/otp.ts              OTP issue/verify, rate limits, verified sessions
src/lib/crypto.ts           AES-256-GCM credential encryption; OTP/PIN hashing
src/lib/auth.ts             Dashboard sessions + tenant/super-admin guards
src/lib/{permissions,usage,audit,documents,transport}.ts
src/app/api/channels/whatsapp/webhook  Routes by phone_number_id → tenant
src/app/api/channels/webchat           Web simulator of messaging an org number
src/app/api/demo-{school,payroll,hospital,business}/*   Simulated third-party systems
src/app/demo/*              "Message an organization" simulator
src/app/dashboard/*         Org dashboard (overview, numbers, connectors, conversations, audit, users)
src/app/admin/*             Super-admin (tenants, plans, usage)
scripts/test.ts             End-to-end + isolation test suite
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full architecture,
security model, and the MVP-vs-roadmap map.
