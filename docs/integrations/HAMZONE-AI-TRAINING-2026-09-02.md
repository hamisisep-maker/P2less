# Integration: Hamzone AI Training & Evaluation platform

P2Less is Client #1 of a separate Hamzone Technologies project — the AI
Training & Evaluation platform (`hamzone-ai-training`, its own repo,
database, and deployment). It reaches into P2Less through exactly two
routes, both defined here. The full, frozen request/response contract
lives in **that repo's own `docs/integrations/P2LESS.md`** — this file is
the P2Less-side operational note (what exists here, how to configure it),
not a duplicate of the contract itself. If the two ever disagree, that
repo's doc is the source of truth for the wire format; fix this file to
match, not the other way round.

## What's here

- `src/app/api/training/evaluate/route.ts` — runs a test input through the
  real `handleInbound()` pipeline and returns the assistant's actual reply.
- `src/app/api/training/findings/route.ts` — receives an already-validated
  finding and files it into the Quality Centre (`/admin/quality`) as a
  `SupportTicket` with `source = "training_platform"`.
- `src/lib/training-auth.ts` — verifies the `X-Hamzone-API-Key` /
  `X-Hamzone-Timestamp` / `X-Hamzone-Signature` headers both routes
  require. Not the same mechanism as `src/lib/api-auth.ts`'s
  `withApiKey` (tenant-scoped developer API) — this is one
  platform-level service credential (`TrainingIntegrationCredential`),
  not tied to any tenant.
- **`/admin/integrations`, "Training platform access" card** — the
  operational kill switch (added 2026-09-02, for the training platform's
  own Phase 5 pre-launch controls): lists every
  `TrainingIntegrationCredential` and lets an admin with
  `integrations.manage_credentials` disable or re-enable one, each
  requiring a reason, each landing in `PlatformAuditLog`
  (`logPrivilegedAction`). Disabling sets `revokedAt` — the exact field
  `training-auth.ts` already checks on every request — so it takes effect
  on the very next call, no redeploy or secret rotation. This is the real
  "something is wrong on the training platform's side, stop touching
  P2Less" button; `src/lib/training-integration-actions.ts` is the
  implementation.

## Configuration required for these routes to work

1. **`TRAINING_PLATFORM_TENANT_ID`** (env var) — the Tenant these routes
   run against. `evaluate` runs real conversation traffic through this
   tenant (synthetic `Contact`s, address `training-eval:<requestId>`, so
   they're never mistaken for real customers); `findings` files tickets
   under it. Currently set to the existing "Hamzone Technologies" dogfood
   tenant (`hamzone` / `cmtip7c63003itwlsq7w0vjvd` in this environment) —
   confirm/update per environment when deploying.
2. **That tenant needs a real, non-zero `Subscription.messageBalanceKes`/
   `.aiBalanceKes`** (or to be otherwise made billing-exempt, if that's
   ever decided) — `handleInbound()` has no bypass for this caller, so a
   zero balance produces the same generic
   `SERVICE_UNAVAILABLE_MESSAGE` fallback a real out-of-balance customer
   would get, not a distinguishable error. Found live while first
   verifying this integration (2026-09-02) — the dogfood tenant's balance
   was 0 despite `status: "active"`. Not a bug; keep this tenant funded.
3. **A `TrainingIntegrationCredential` row** — no self-service issuing
   endpoint exists; create one with a short script (raw `PrismaClient`,
   same reasoning as `scripts/reset-password.ts` for avoiding the
   `server-only` + `tsx` conflict — see that script's own comment) that
   generates an `apiKey`/`signingSecret` pair, stores `keyHash =
   sha256(apiKey)` and `encryptedSigningSecret = encryptJSON({ secret:
   signingSecret })`, and prints the pair once. Hand the pair to
   `hamzone-ai-training` out of band — it stores them in the relevant
   `AiSystem.adapterConfig`, encrypted the same way on that side.
   `scripts/training-test-fixtures.ts` (below) does exactly this for test
   credentials — same shape, disposable, not for a real production pair.

## `scripts/training-test-fixtures.ts`

A small CLI (`create-credential`, `revoke-credential`,
`disable-credential`, `enable-credential`, `get-tenant-by-slug`,
`get-balance`, `set-balance`, `count-tickets`, `cleanup-tickets`) that
`hamzone-ai-training`'s automated cross-integration test
(`npm run test:cross-integration` over there) shells out to for setup/
teardown it can't do through the HTTP routes themselves — issuing a
disposable test credential, temporarily zeroing/restoring the test
tenant's balance to exercise the billing gate, verifying no duplicate
ticket was created, and (added 2026-09-02) disabling/re-enabling a
credential to prove the real `/admin/integrations` kill switch through an
actual live task, not just a DB read. `disable-credential`/
`enable-credential` touch the exact same `revokedAt` field the real admin
UI action does — `revoke-credential` is a separate, permanent hard-delete
used only for test cleanup, never for testing the kill switch itself.
Not used by anything in this repo directly; exists because the other repo
needs it. Every command prints one line of JSON — keep it that way if
extending it, since that's the contract the caller parses.

## Quality Centre category mapping

`findings/route.ts`'s `QUALITY_CATEGORY_BY_KEYWORD` maps the training
platform's freeform `Finding.category` (e.g. `"prompt_injection"`) onto
this repo's fixed `QUALITY_CATEGORIES` taxonomy
(`src/lib/quality-taxonomy.ts`) via keyword matching, defaulting to
`"unknown_investigating"` rather than guessing wrong. It's a starting
point — any admin can reclassify a `training_platform` ticket from its own
page exactly like any other ticket.

## Verified 2026-09-02, now repeatably (not just a one-off manual pass)

First verified manually against a real running instance of this app:
successful evaluate + findings calls, rejected bad signature, rejected
>5-minute-old timestamp, rejected invalid payloads, a duplicate
`X-Idempotency-Key` correctly returning the same `SupportTicket` id instead
of creating a second one — and one real finding from that pass, not a code
bug: the designated tenant needs a funded balance or the real billing gate
blocks `evaluate` exactly like it would for a real out-of-balance customer.

That manual pass is now automated and repeatable: `hamzone-ai-training`'s
`npm run test:cross-integration` starts (or reuses) a real instance of this
app via `npm run dev` and runs the full scenario list — every auth case,
the real billing gate, real idempotent duplicate handling, the real
per-credential rate limiter (a burst of requests reliably trips it), and
(added 2026-09-02, for that repo's Phase 5A pre-launch controls) the real
`/admin/integrations` kill switch exercised through an actual live task:
disabling a credential blocks a real `runEvaluation()` call immediately,
re-enabling it restores service, no redeploy — against real signed HTTP
requests, self-cleaning afterward (revokes its test credential, restores
the tenant's balance, removes its test tickets). 16/16 passing as of this
note. Run it again after any change to `src/app/api/training/*`,
`src/lib/training-auth.ts`, `src/lib/training-integration-actions.ts`, or
`src/lib/quality-taxonomy.ts`'s `TICKET_SOURCES`/`QUALITY_CATEGORIES`.

Not yet exercised: a staging/production deployment, or connection to a
real training campaign (deferred behind a controlled pilot per the
training platform's ADR 0001) — and who funds the designated tenant's
P2Less AI usage during that pilot is decided in that repo's
`docs/adr/0002-training-evaluation-billing.md`.
