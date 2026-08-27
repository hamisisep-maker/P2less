# Scaling migration scope: SQLite → Postgres + horizontal scaling

Recorded 2026-08-27. **Documentation only — nothing in this doc has been built.** Written in response to a direct question: could P2Less, loaded with enough paid (non-free-tier) AI provider capacity, handle 10,000 messages in one minute for an e-commerce client? Short answer: no, not today, and the AI providers were never the bottleneck — the database and deployment architecture are. This doc scopes what would actually need to change, based on a real, evidence-based read of the current codebase (not general "move to Postgres" advice).

---

## Why this isn't urgent to build right now

Per [[project-p2less-gtm-strategy]], P2Less has zero real paying clients as of 2026-08-22, and the GTM plan is a single warm-network pilot first, not a mass-volume launch. Nothing in today's traffic pattern needs this. This doc exists so the real cost is known **before** a client is promised a throughput number the current architecture can't back up — not because the migration should start now. Revisit when a real client's expected volume approaches double digits of messages per minute sustained, well below 10,000/min.

---

## Current architecture, as it actually is

- **Database**: SQLite, single file (`prisma/schema.prisma`: `provider = "sqlite"`), living on a single mounted Railway volume at `/data/prod.db`.
- **Deployment**: one Railway service, one process. No `Procfile`, no Docker Compose, no replica count anywhere in the repo — confirmed by direct search, not assumed. `package.json`'s `"start": "node scripts/prod-start.mjs"` is the only production entrypoint, and it does schema sync + one-time data backfills + provisioning **and then** starts the Next.js server, all in one non-separated boot sequence.
- **WhatsApp unofficial transport (Baileys)**: a real, stateful WebSocket connection per connected number, held in server memory for the life of the process.
- **Background jobs**: 8+ recurring jobs (billing lifecycle, notifications, reconciliation, incident detection, ticket SLA, social token health, delivery dispatch, DB/integration health) all started via `setInterval` from `instrumentation.ts`, once per process.

None of this was built wrong for a single-instance, pre-launch product — SQLite and a single process are the right choice at this stage (zero ops overhead, zero cost, "every model is portable" per the schema's own comment). The gap is only real once real concurrent volume shows up.

---

## What actually blocks 10,000 messages/minute today

### 1. SQLite is a single-writer database
At ~167 messages/second, every inbound message writes to `Message`, `Conversation`, `AiRequestLog`, and related tables. SQLite serializes all writes to the one file — this level of concurrent write volume would produce "database is locked" errors and stalled replies long before AI provider capacity became the limiting factor, regardless of how many paid keys are loaded.

### 2. Several code paths are correct *only because* SQLite serializes writers — this is the finding that matters most
These aren't hypothetical Postgres concerns — they're **already documented as fragile in their own code comments**, written by whoever built them, specifically flagging "this needs re-verification before Postgres + multiple instances":

- **`conversation.ts` (training-session participant question-count cap)**: a read-then-increment-with-a-cap pattern inside a `$transaction`, with no row lock. The code's own comment says this "would need re-verification — a real row lock or constraint-based upsert — before ever running against Postgres with multiple app instances." Under real concurrency, two simultaneous messages from the same person could both pass the limit check and both get admitted past the cap.
- **`audit.ts` / `audit-chain.ts` (the tamper-evidence audit-log hash chain)** — this is the serious one. The chain write is read-then-write inside a transaction, correct today only because "SQLite serializes concurrent write transactions, so the second one to commit correctly sees the first one's row." Under Postgres with concurrent instances, two simultaneous audit writes for the same tenant could both read the same "previous" row and each chain a new entry to it — **silently forking the tamper-evidence chain with no visible failure**, defeating the entire point of `verifyAuditChain()`. This must be fixed (row lock, `SERIALIZABLE` + retry, or a Postgres advisory lock per tenant) as part of any Postgres migration, not treated as optional.
- **`ticket-numbering.ts` (ticket/incident/invoice sequence numbers)** — same read-then-write-no-lock pattern, same "safe only because SQLite serializes writers" comment. Two simultaneous invoice creations could get the same number under real concurrency.

### 3. In-memory state that only works because there's one process
Several `globalThis`-backed singletons (the `REGISTRY` pattern, used deliberately to survive Next.js's per-bundle module duplication) hold real state that has no cross-instance visibility:

- **`whatsapp-baileys.ts`**: live Baileys sockets, pending QR codes, pending pairing codes, remembered pairing phone numbers. A WhatsApp socket is inherently single-process — this is the hardest item on this whole list, covered separately below.
- **`ai.ts`**: the decrypted AI-key cache and the per-key cooldown map (which key just hit a quota error and should be skipped for 5 minutes) are both process-local. Under multiple instances, each instance independently decides a key is cooling down — the same already-failing key could get hit by every other instance immediately after failing on one, defeating the entire purpose of the cooldown.
- **`job-runner.ts`**: every instance independently runs its own `setInterval` for every background job. With N instances, each job runs N× per interval — billing charge attempts, notification dispatch, and reconciliation would all execute redundantly. Some of this is protected by DB-level dedupe (e.g. `Notification.dedupeKey`), but not all jobs were verified to have the same protection.
- **`rate-limit.ts`**: explicitly self-documented in its own comment as "process-local... would need a shared store (Redis) under real horizontal scaling."
- **The WhatsApp webhook's inbound-message dedupe** (`handledIds`, a size-capped in-memory `Set` of already-processed message ids): also explicitly self-documented as single-instance-only, and independently flagged in `SYSTEM-DISCOVERY-2026-08-19.md` as a known gap.

### 4. Baileys' on-disk auth state
Each unofficial-transport number's WhatsApp session credentials are written to disk (`useMultiFileAuthState`, one folder per number under `/data/baileys-auth/`) via Baileys' own file-based auth-state helper. This is fine for one process on one volume — it does not survive being spread across multiple instances unless every instance shares that volume, and even then, the live socket itself still can't be shared (see below).

### 5. The boot script assumes it's the only thing running
`scripts/prod-start.mjs` runs schema sync (`prisma db push`) and several one-time data backfills/migrations directly at every boot, then starts the server — all in one script, on every instance. Running this concurrently from 2+ instances scaling up or deploying simultaneously would race on the same schema push and the same backfills. Most backfills are individually guarded by a not-yet-set marker field (so likely idempotent-safe on their own), but the script isn't designed for concurrent execution as a whole.

### 6. WhatsApp's own rate limits are a separate ceiling, independent of P2Less's infrastructure
Even with a perfect, infinitely-scaled backend:
- The **unofficial (Baileys) transport already demonstrated today** that WhatsApp applies real anti-abuse throttling (the `error 463` / "reachout timelock" restriction hit during this session's testing) at volume far below 10,000/minute. This transport was never designed for real production volume — it's a personal-device-linked connection, not a business API.
- The **official Meta Cloud API** has its own tiered messaging limits that scale with a number's quality rating and trust tier over time (new numbers start capped at a limited number of unique customers per 24 hours) — this isn't something more AI budget or better infrastructure can bypass; it's Meta's own policy layer, and it ramps up gradually with real usage, not on demand.

**This means even a fully-migrated, horizontally-scaled P2Less would still need to plan around WhatsApp's own throughput ceiling — 10,000/minute sustained through a single WhatsApp number is not realistic regardless of backend architecture.** A real high-volume client would likely need multiple registered numbers and Meta's higher messaging tiers, which themselves require a track record of good sending behavior.

---

## What the migration would actually involve, phased

**Phase 1 — Postgres migration itself**
Swap `datasource provider` to `postgresql`, provision a real Postgres instance, migrate data (schema is already portable — no SQLite-specific column types were found; every JSON field already uses Prisma's native `Json` type, which maps straight to Postgres `jsonb`). Low-risk, mechanical work on its own.

**Phase 2 — Fix the SQLite-single-writer-reliant code paths (must happen with or before Phase 1, not after)**
Add real row-level locking or constraint-based upserts to: the audit-log hash chain (`audit.ts`/`audit-chain.ts`), the training-session participant counter, and ticket/invoice/incident sequence numbering. This is correctness work, not scaling work — skipping it means the audit trail's tamper-evidence guarantee is silently broken the first time two admins act concurrently on Postgres, whether or not the app is ever horizontally scaled.

**Phase 3 — Separate the release/migration step from app boot**
Split `prod-start.mjs` into a one-off migration/release step (schema push + backfills, run once before any instance serves traffic) and a plain app-boot step (just starts the server) — the standard pattern for any horizontally-scaled deployment.

**Phase 4 — Move shared state out of process memory (Redis, or Postgres-backed equivalents)**
The AI-key cooldown cache, the rate limiter, and the webhook inbound-message dedupe set all need a shared store once there's more than one instance. This is comparatively mechanical once a shared store exists.

**Phase 5 — Background jobs: single-owner execution**
Either run jobs from one dedicated worker instance separate from the horizontally-scaled web tier, or add real distributed leader-election. Needs a per-job audit of which ones are safely idempotent under concurrent execution (dedupe keys exist for some, not verified for all) before deciding which approach is cheaper.

**Phase 6 — Baileys/WhatsApp connections: the hardest, most structural item**
A WhatsApp socket is fundamentally single-process-owned — this isn't a "add a shared cache" fix. Two real options: (a) pin each connected number to one specific instance (sticky routing / a DB-backed lock claiming ownership per number), or (b) move all Baileys connections into their own small, separate, non-scaled worker service, with the horizontally-scaled web tier talking to it rather than holding sockets itself. Given the WhatsApp-side rate-limiting already observed, and that Baileys is explicitly a fallback transport (not the primary path for real customer volume — the official Meta Cloud API is), this phase may be lower priority than it looks: a real high-volume client should be on the official transport anyway, where this problem doesn't exist in the same form.

---

## Bottom line

More AI provider budget alone does not get P2Less to 10,000 messages/minute. The real work is: fix three specific correctness bugs that are currently invisible because SQLite happens to mask them, migrate to Postgres, separate the boot/release step, move a handful of in-memory caches to a shared store, and — the genuinely hard part — redesign how WhatsApp connections are held so they're not tied to one process. None of this is started. All of it is real, scoped, buildable work once there's an actual client whose volume justifies it — and even then, WhatsApp's own per-number rate limits mean the honest sustained-throughput promise to a client should be built around Meta's official tiers, not a raw infrastructure number.
