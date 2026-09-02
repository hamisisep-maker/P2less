# P2Less — Universal Conversational Access & Integration Platform

> **Read [`docs/PROJECT-STATUS-2026-08-24.md`](docs/PROJECT-STATUS-2026-08-24.md) first.** This README describes the original MVP shape and is not kept current — PROJECT-STATUS is the one doc that states the real goal, everything actually shipped, and everything genuinely remaining, and it's updated every round. This file stays as the quick local-setup guide below.

## Lost your laptop? Start here.

Everything that matters is on GitHub and Railway, not on any one machine — a fresh laptop gets you fully back up in a few minutes:

1. **Clone the repo**: `git clone https://github.com/hamisisep-maker/P2less.git` (this platform is the `p2less-platform/` folder inside it).
2. **Read `docs/PROJECT-STATUS-2026-08-24.md`** for the current goal/achieved/remaining picture, then `docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md` and `docs/EXTERNAL-REGISTRATIONS-CHECKLIST-2026-08-24.md` for full detail on any specific item.
3. **Production is already live and doesn't need local setup at all**: <https://p2less-app-production.up.railway.app>. Log into `/admin` as the super admin to see real tenant/usage data straight away.
4. **For local development**, `.env` is deliberately never committed (it holds real secrets) — get the real values back with the Railway CLI, not from memory: `npm install -g @railway/cli` (if needed) → `railway login` → `railway link` (pick the P2Less project) → `railway variables` prints every real key currently live in production. Copy the ones you need into a fresh local `.env` (see `.env`'s own inline comments in git history, or ask to have one regenerated, for which vars are expected).
5. **Deploys**: `git push origin main` (source of truth) then `railway up --detach` from inside `p2less-platform/` (already linked once you've done step 4) — no CI pipeline, this is the actual deploy path used every round.

> **Standing rule going forward**: every commit gets pushed immediately, and `docs/PROJECT-STATUS-2026-08-24.md` is kept current every round specifically so this recovery path always works, not just as of whenever it was last convenient.

## P2Less is one of two related but independently deployed Hamzone Technologies projects

P2Less is Hamzone Technologies' own AI product. There's a second, **entirely
separate** repository — [`hamzone-ai-training`](https://github.com/hamisisep-maker/hamzone-ai-training)
— Hamzone's AI Training & Evaluation platform (paid workers/reviewers who
test and harden AI systems, P2Less among them). The relationship:

```
P2Less
  └── AI product
       │
       ├── POST /api/training/evaluate
       │
       └── POST /api/training/findings
                         ↑
                         │
              hamzone-ai-training
```

Concretely:

- **P2Less owns its own database.** The training platform has a completely
  separate one.
- **They do not share Prisma models or database tables.** Nothing in
  `hamzone-ai-training` ever queries this database directly, and nothing
  here ever queries theirs.
- **Integration happens only through authenticated APIs** — the two routes
  below, nothing else.
- **P2Less is the training platform's first client**, not a special case
  baked into its design — see that repo's own README for why that
  distinction matters to them.
- **P2Less-specific implementation details stay behind the API boundary.**
  `handleInbound()`, this repo's Prisma models, internal services — none of
  it is ever exposed to or assumed by the training platform. If those
  internals change, only the two routes below need to keep honoring their
  existing contract.

The two routes that make up that boundary, both living on **this** side:

- `POST /api/training/evaluate` — accepts a test input, runs it through the
  real inbound pipeline, returns the response. **Not built yet.**
- `POST /api/training/findings` — accepts one validated finding from a
  completed review, files it into `/admin/quality`. **Not built yet.**

Full reasoning lives in two places on the `hamzone-ai-training` side:
[`docs/ARCHITECTURE.md`](https://github.com/hamisisep-maker/hamzone-ai-training/blob/main/docs/ARCHITECTURE.md)
(why two repos, why two databases, what belongs where) and
[`docs/integrations/P2LESS.md`](https://github.com/hamisisep-maker/hamzone-ai-training/blob/main/docs/integrations/P2LESS.md)
(the exact contract these two routes must satisfy). Read those before
touching either route — the contract they need to honor is defined there,
not here.

---

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
