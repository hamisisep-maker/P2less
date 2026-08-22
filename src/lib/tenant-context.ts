import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Tenant-isolation hardening — carries the CURRENT tenant through to db.ts's
// Prisma Client Extension (src/lib/db.ts), which auto-scopes every query on a
// tenant-scoped model to this tenant. Mirrors ai-context.ts's exact pattern:
// enterWith() for request-scoped entry points (applies to the rest of the
// current async call chain, no wrapping callback needed), a real .run()
// callback scope for background-job loops that must isolate one tenant's
// iteration from the next.
// ─────────────────────────────────────────────────────────────────────────────

type TenantContext = { tenantId: string };

// Backed by globalThis, same reasoning as job-runner.ts's registry Map: Next.js
// bundles server code into separate module graphs per entry point (route
// handlers vs. shared libs like db.ts vs. instrumentation.ts) — a plain
// module-level `new AsyncLocalStorage()` can end up as TWO different
// instances, so a value set via one import path is invisible to code reading
// it via another. Confirmed live: enterTenantContext() called from a route
// handler was NOT visible to getCurrentTenantId() called from inside db.ts's
// Prisma extension until this fix.
const storageHolder = globalThis as unknown as { __p2lessTenantStorage?: AsyncLocalStorage<TenantContext> };
storageHolder.__p2lessTenantStorage ??= new AsyncLocalStorage<TenantContext>();
const storage = storageHolder.__p2lessTenantStorage;

/** Call once per inbound request/action, right after the tenant is known —
 *  e.g. requireTenantUser(), withApiKey(), each channel webhook right after
 *  it resolves which tenant a message belongs to. */
export function enterTenantContext(tenantId: string): void {
  storage.enterWith({ tenantId });
}

/** For background jobs that loop over MANY tenants in one function
 *  invocation (e.g. runReconciliationSweep finds stale payments across every
 *  tenant, then processes each). A real callback scope so each iteration's
 *  context is isolated and automatically pops back to "no tenant" afterward
 *  — enterWith() would instead persist for the rest of the job function,
 *  bleeding into the next iteration or any post-loop code. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return storage.run({ tenantId }, fn);
}

export function getCurrentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}
