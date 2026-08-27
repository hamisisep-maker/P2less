import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Carries the CURRENT tenant through to the AI cost ledger (AiRequestLog in
// ai.ts) without threading a tenantId parameter through every one of the ~20
// call sites across conversation.ts. Set once, right after the tenant is
// resolved in handleInbound(), via enterWith() (not .run()) — it applies to
// the REST of the current async call chain from that point on, no need to
// restructure handleInbound into a wrapped callback.
// ─────────────────────────────────────────────────────────────────────────────

type AiContext = { tenantId: string };

// Backed by globalThis, same reasoning as tenant-context.ts's storageHolder
// and job-runner.ts's registry Map: Next.js bundles server code into separate
// module graphs per entry point (conversation.ts's handleInbound, which sets
// this, vs. ai.ts's cost logger, which reads it, are not guaranteed to share
// one module instance) — a plain module-level `new AsyncLocalStorage()` can
// end up as TWO different instances, so a value set via one import path is
// invisible to code reading it via another. This exact bug was found and
// fixed in tenant-context.ts on 2026-08-22; this file predates that fix and
// was flagged at the time as having the same latent risk, not yet
// investigated. Fixed here the same way, 2026-08-27.
const storageHolder = globalThis as unknown as { __p2lessAiContextStorage?: AsyncLocalStorage<AiContext> };
storageHolder.__p2lessAiContextStorage ??= new AsyncLocalStorage<AiContext>();
const storage = storageHolder.__p2lessAiContextStorage;

/** Call once per inbound request, right after the tenant is known. */
export function setAiTenantContext(tenantId: string): void {
  storage.enterWith({ tenantId });
}

/** Read by ai.ts's cost logger. Undefined when no tenant is known yet (e.g.
 *  voice-note transcription runs before routing resolves the tenant) — the
 *  cost is still logged, just without tenant attribution, rather than guessed. */
export function getAiTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}
