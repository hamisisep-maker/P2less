import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentTenantId, isCrossTenantContext } from "./tenant-context";

// ─────────────────────────────────────────────────────────────────────────────
// Tenant-isolation hardening — structural backstop for SQLite (no Row-Level
// Security available here), since app-layer discipline alone means a
// developer forgetting `where: { tenantId }` in a new query is a silent
// cross-tenant leak with no error. This extension auto-scopes every query on
// a tenant-scoped model to whatever tenant tenant-context.ts says is current
// — a query that forgets to filter now comes back correctly scoped anyway,
// rather than leaking.
//
// Pilot (Contact only) verified live 2026-08-22 via a temporary debug route:
// cross-tenant findUnique correctly returned null, cross-tenant update
// correctly threw P2025 without modifying the row, and — the actual point of
// this feature — a findMany with NO where clause at all still came back
// correctly scoped to only the current tenant's rows. Expanded to the full
// Phase 1 list same day, then to Phase 2 (the rest) after verifying each
// model's real call sites first, not blindly:
// - Notification.tenantId is intentionally nullable (platform-wide alerts
//   have none) — safe: queueNotification() (notifications.ts) always sets
//   `tenantId: opts.tenantId ?? null` explicitly, never omits the key, so
//   the create-auto-stamp below (which only fires on `undefined`) never
//   overrides a deliberate platform-wide `null`.
// - AuditLog is unambiguously always tenant-scoped — PlatformAuditLog is a
//   genuinely separate model (no tenantId field at all) for admin actions.
// - Role/Branch have a required (non-nullable) tenantId — no platform-wide
//   shared row exists for either.
// - User is safe because getCurrentUser() (auth.ts) — the lookup that
//   resolves who's logged in — always runs BEFORE any tenant context is
//   ever set (it's what establishes whether to set one), on every request
//   type (dashboard, admin, API).
// - Payment: the two M-Pesa webhook routes now call enterTenantContext()
//   right after resolving which tenant a callback belongs to, same pattern
//   as every channel webhook.
// - DeliveryZone/Driver/DeliveryTrip were simply not in the original
//   hand-picked Phase-1 list, not deliberately excluded — same low risk as
//   the rest of Phase 1, already exercised inside handleInbound()'s tenant
//   context (driver routing) and the payment webhooks above.
// ─────────────────────────────────────────────────────────────────────────────

export class TenantContextMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextMissingError";
  }
}

const TENANT_SCOPED_MODELS = new Set([
  "Contact", "Conversation", "Message", "Document", "AuthSession",
  "Product", "Order", "SupportTicket", "ApiKey", "Webhook",
  "WhatsAppNumber", "Channel", "WidgetKey", "Connector",
  "Notification", "AiRequestLog", "AiCallEvent", "UsageEvent", "AuditLog",
  "Payment", "Subscription", "DeliveryZone", "Driver", "DeliveryTrip",
  "User", "Role", "Branch",
]);

const READ_MANY_OPS = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const WRITE_MANY_OPS = new Set(["updateMany", "deleteMany"]);
// findUnique/findUniqueOrThrow/update/delete query BY UNIQUE KEY — Prisma's
// typed API doesn't allow adding a non-unique tenantId into that `where`.
// Handled below via verify-then-execute instead of where-injection.
const BY_ID_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete"]);

function buildClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  return base.$extends({
    name: "tenant-scoping",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args);
          const tenantId = getCurrentTenantId();
          if (!tenantId) {
            // FAIL CLOSED, 2026-08-24 — second attempt, after finding and
            // fixing the REAL root cause of the 2026-08-23 outage. That
            // day's write-up blamed "RSC page renders don't propagate
            // AsyncLocalStorage" — wrong, disproved by direct isolated
            // testing (same-function reads, reads after await, and
            // parent→child component rendering all work fine). The actual
            // mechanism, found by reproducing the failure against a real
            // `next build && next start` (the 08-23 fix was only ever
            // verified under `next dev`, which hides this): a guard function
            // that calls enterTenantContext()/enterCrossTenantContext() and
            // then RETURNS a value for its caller to keep using loses that
            // context the instant it returns — even one line later, even in
            // a plain Route Handler, not RSC-specific at all. Every real
            // entry point (auth.ts's withTenantUser, admin-authz.ts's
            // withAdminPermission/withAssertAdminPermission/withAnyAdmin)
            // now sets context and synchronously invokes the caller's
            // remaining logic as a callback instead — see tenant-context.ts.
            //
            // Verified before re-enabling this throw, not assumed: rebuilt
            // with this exact throw temporarily in place, clicked through
            // every dashboard page as a real tenant and every admin page as
            // the real seeded super admin under `next start` — zero
            // context-missing errors. Deployed with this still warn-only
            // first and watched real production traffic for ~8 minutes —
            // zero [TENANT-CONTEXT-MISSING] hits — before flipping this back
            // to a throw in a separate, later change, exactly as planned.
            //
            // If this ever fires again in production: it means a NEW call
            // site was added that does tenant-scoped db.ts work without
            // going through one of the withXxx() wrappers above — find it
            // via the digest/stack in the log, fix that call site the same
            // way, do NOT revert this back to warn-only as the fix.
            if (!isCrossTenantContext()) {
              throw new TenantContextMissingError(`${model}.${operation} ran with no tenant context established.`);
            }
            return query(args);
          }
          const a = args as Record<string, unknown>;

          if (READ_MANY_OPS.has(operation) || WRITE_MANY_OPS.has(operation)) {
            const where = a.where as Record<string, unknown> | undefined;
            a.where = where ? { AND: [{ tenantId }, where] } : { tenantId };
            return query(a);
          }
          if (operation === "create") {
            const data = a.data as Record<string, unknown> | undefined;
            if (data && data.tenantId === undefined) data.tenantId = tenantId;
            return query(a);
          }
          if (operation === "createMany" && Array.isArray(a.data)) {
            a.data = (a.data as Record<string, unknown>[]).map((d) => (d.tenantId === undefined ? { ...d, tenantId } : d));
            return query(a);
          }
          if (BY_ID_OPS.has(operation)) {
            // Verify a row matching BOTH the unique key AND this tenant
            // exists before running the real operation — identical behavior
            // whether the id belongs to another tenant or doesn't exist at
            // all, so no error shape ever leaks "that id exists, just not
            // yours." Queried against the BASE (unextended) client to avoid
            // any recursion subtlety.
            //
            // Real bug caught by the regression suite before shipping: a
            // model with a COMPOUND unique constraint (e.g. Role's
            // @@unique([tenantId, key])) gets a synthetic wrapper key in its
            // findUnique `where` (e.g. { tenantId_key: { tenantId, key } }) —
            // that shape is NOT valid as a findFirst/findMany filter (Prisma
            // throws "Unknown argument tenantId_key"). Using findUnique
            // itself for the check instead of findFirst sidesteps this
            // entirely — a.where is BY DEFINITION already a valid findUnique
            // where (it's literally what the caller passed for one), so it
            // works for both simple (`{id}`) and compound-key shapes
            // uniformly. The tenant check happens as a plain JS comparison
            // afterward instead of inside the query.
            const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const modelClient = (base as any)[modelKey];
            const row = await modelClient.findUnique({ where: a.where, select: { id: true, tenantId: true } });
            const owned = row && row.tenantId === tenantId;
            if (!owned) {
              if (operation === "findUnique") return null;
              throw new Prisma.PrismaClientKnownRequestError(
                "An operation failed because it depends on one or more records that were required but not found.",
                { code: "P2025", clientVersion: Prisma.prismaVersion.client },
              );
            }
          }
          return query(a);
        },
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof buildClient> };

export const db = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
