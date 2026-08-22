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

type TenantContext = { tenantId: string; channelLabel?: string; channelType?: string };

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

/** Read by ai.ts's smallTalk() so it describes itself using the REAL channel
 *  the visitor is actually on, instead of a hardcoded assumption. Falls back
 *  to "WhatsApp" (the dominant real channel, and every caller that predates
 *  multi-channel support) when unset. */
export function getCurrentChannelLabel(): string {
  return storage.getStore()?.channelLabel ?? "WhatsApp";
}

/** Real bug found live 2026-08-22: the AI offered to "analyze a spreadsheet
 *  or PDF, just drop it here" on the website widget — a genuine platform
 *  capability (src/lib/tools), but WhatsApp is the only channel that
 *  actually supports file attachments today (Messenger/Telegram/Email/
 *  widget are all documented text-only in this codebase's own build notes).
 *  Read by conversation.ts's toolCapabilityLines() to only surface
 *  file-based tools on a channel that can actually receive a file. Defaults
 *  to true (WhatsApp behavior) when unset, matching every caller that
 *  predates multi-channel support. */
export function currentChannelSupportsFiles(): boolean {
  const type = storage.getStore()?.channelType;
  return type === undefined || type === "whatsapp";
}
