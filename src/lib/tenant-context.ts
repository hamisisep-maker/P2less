import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Tenant-isolation hardening — carries the CURRENT tenant through to db.ts's
// Prisma Client Extension (src/lib/db.ts), which auto-scopes every query on a
// tenant-scoped model to this tenant. Mirrors ai-context.ts's exact pattern.
//
// Every function here uses enterWith() (ambient mutation of the current async
// context), never storage.run(). A real bug found and fixed 2026-08-23:
// runWithTenant()/runCrossTenant() originally used storage.run() on the
// documented theory that a real callback scope isolates one loop iteration
// better than ambient mutation — proved wrong by a live isolated test
// (see runWithTenant's comment): storage.run()'s context reliably did NOT
// survive into Prisma's $allOperations extension callback in this Prisma
// version, so every query inside a runWithTenant/runCrossTenant callback
// silently ran with NO context at all. enterWith() is confirmed live to work
// correctly through the same extension.
//
// Also carries the current CHANNEL label (WhatsApp/Messenger/Telegram/Email/
// the website chat) — same "set once at handleInbound, read deep inside
// ai.ts's smallTalk()" shape as the tenant id, so it's a natural fit for the
// same store rather than a second AsyncLocalStorage instance. Real bug this
// closes, found live 2026-08-22: smallTalk()'s prompt hardcoded "WhatsApp"
// unconditionally, so the landing page's own website-widget conversation
// confidently told a visitor "P2Less is the WhatsApp assistant platform" —
// wrong, and undermining the exact multi-channel pitch the page makes.
// ─────────────────────────────────────────────────────────────────────────────

type TenantContext = { tenantId?: string; channelLabel?: string; channelType?: string; crossTenant?: boolean };

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

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  messenger: "Facebook Messenger",
  telegram: "Telegram",
  email: "email",
  widget: "the website chat",
  webchat: "webchat",
};

/** Call once per inbound request/action, right after the tenant is known —
 *  e.g. requireTenantUser(), withApiKey(), each channel webhook right after
 *  it resolves which tenant a message belongs to. `channelType` (e.g.
 *  "whatsapp"/"messenger"/"widget") is optional — dashboard/API entry points
 *  have no channel concept and omit it. */
export function enterTenantContext(tenantId: string, channelType?: string): void {
  const channelLabel = channelType ? (CHANNEL_LABELS[channelType] ?? channelType) : undefined;
  storage.enterWith({ tenantId, channelLabel, channelType });
}

/** For background jobs that loop over MANY tenants in one function
 *  invocation (e.g. runReconciliationSweep finds stale payments across every
 *  tenant, then processes each) — sets context for the current iteration.
 *
 *  REAL BUG FOUND 2026-08-23, fixed same day: this used to use
 *  `storage.run({ tenantId }, fn)`, on the documented theory that a real
 *  callback scope isolates one iteration from the next better than
 *  enterWith()'s ambient mutation. Proved wrong by a live isolated test
 *  (src/app/api/debug-ctx, temporary): `storage.run()`'s context reliably
 *  does NOT survive into Prisma's `$allOperations` extension callback in
 *  this Prisma version — the query dispatch escapes whatever continuation
 *  chain `.run()` tracks, so every query inside the callback saw NO context
 *  at all, not even the wrong one. `enterWith()`-based context, confirmed
 *  live to work correctly through the same extension. Every call site here
 *  is a sequential `for...of` loop (never `Promise.all`), so ambient mutation
 *  is safe: each iteration sets its own tenantId before its own work runs,
 *  with no concurrent interleaving to race against. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  storage.enterWith({ tenantId });
  return fn();
}

export function getCurrentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fail-open audit, 2026-08-23: db.ts's tenant-scoping extension used to treat
// "no tenant context" as "run the query unscoped" unconditionally — the ONE
// failure mode the whole extension exists to catch (a forgotten
// enterTenantContext call) was indistinguishable from a legitimate,
// intentional cross-tenant read (every /admin/** page, every background
// job), so it could only ever fail open. These two functions make "cross-
// tenant is deliberate here" an explicit, checkable fact instead of an
// absence — called from requireSuperAdmin() and assertAdminPermission()
// (every /admin/** page and server action) and from job-runner.ts's
// runJobNow() (every scheduled AND manually-triggered background job — the
// single real choke point, confirmed by audit: every job in this codebase
// executes only through it, never a raw sweep function call). Anywhere
// NEITHER this NOR a real tenantId is set is now the true bug signal, and
// db.ts fails closed for it.
// ─────────────────────────────────────────────────────────────────────────────

/** Call once per request that is INTENTIONALLY cross-tenant (an admin page
 *  or action) — persists for the rest of the current async chain, same
 *  enterWith() shape as enterTenantContext(). */
export function enterCrossTenantContext(): void {
  storage.enterWith({ crossTenant: true });
}

/** Same intent as enterCrossTenantContext(), for one background-job
 *  execution (job-runner.ts's runJobNow wraps every job with this).
 *  Uses enterWith() internally, not storage.run() — see runWithTenant's
 *  comment for the real bug this fixes: storage.run()'s context did not
 *  survive into Prisma's extension callback, confirmed by a live isolated
 *  test. Each runJobNow() call is a fresh, independent async invocation
 *  (from setInterval or a server action) with nothing after it that needs
 *  the prior context back, so enterWith()'s ambient (non-popping) mutation
 *  is safe here too. */
export function runCrossTenant<T>(fn: () => T): T {
  storage.enterWith({ crossTenant: true });
  return fn();
}

export function isCrossTenantContext(): boolean {
  return storage.getStore()?.crossTenant === true;
}

/** Read by ai.ts's smallTalk() so it describes itself using the REAL channel
 *  the visitor is actually on, instead of a hardcoded assumption. Falls back
 *  to "WhatsApp" (the dominant real channel, and every caller that predates
 *  multi-channel support) when unset. */
export function getCurrentChannelLabel(): string {
  return storage.getStore()?.channelLabel ?? "WhatsApp";
}

/** Real bug found live 2026-08-22: the AI offered to "analyze a spreadsheet
 *  or PDF, just drop it here" on the website widget when it had no
 *  attachment plumbing at all yet. Messenger gained real attachment
 *  handling after this gate was first written (found stale 2026-08-27,
 *  fixed here) and the widget gained its own — voice notes, photos,
 *  documents, video — 2026-08-28 (see the widget channel route and
 *  public/widget.js). Telegram/email still have none. Read by
 *  conversation.ts's toolCapabilityLines() to only surface file-based tools
 *  on a channel that can actually receive a file. Defaults to true
 *  (WhatsApp behavior) when unset, matching every caller that predates
 *  multi-channel support. */
export function currentChannelSupportsFiles(): boolean {
  const type = storage.getStore()?.channelType;
  return type === undefined || type === "whatsapp" || type === "messenger" || type === "widget";
}
