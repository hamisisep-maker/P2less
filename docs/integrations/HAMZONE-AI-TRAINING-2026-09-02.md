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

## Quality Centre category mapping

`findings/route.ts`'s `QUALITY_CATEGORY_BY_KEYWORD` maps the training
platform's freeform `Finding.category` (e.g. `"prompt_injection"`) onto
this repo's fixed `QUALITY_CATEGORIES` taxonomy
(`src/lib/quality-taxonomy.ts`) via keyword matching, defaulting to
`"unknown_investigating"` rather than guessing wrong. It's a starting
point — any admin can reclassify a `training_platform` ticket from its own
page exactly like any other ticket.

## Verified 2026-09-02

Both routes exercised against a real running instance of this app (not
mocked) from a real signed request: successful evaluate + findings calls,
rejected bad signature, rejected >5-minute-old timestamp, rejected invalid
payloads, and a duplicate `X-Idempotency-Key` correctly returning the same
`SupportTicket` id instead of creating a second one. Not yet exercised: a
staging/production deployment, or connection to a real training campaign
(deferred behind a controlled pilot per the training platform's ADR 0001).
