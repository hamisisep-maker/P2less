import { PrismaClient, Prisma } from "@prisma/client";
import { getCurrentTenantId } from "./tenant-context";

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
// correctly scoped to only the current tenant's rows. Now expanded to the
// full Phase 1 list. Deliberately NOT touching Notification/AiRequestLog/
// AiCallEvent/UsageEvent/AuditLog/Payment/Subscription (heavily queried
// cross-tenant by /admin/** and system-health.ts) or User/Role/Branch
// (already RBAC-gated) — Phase 2, if ever.
// ─────────────────────────────────────────────────────────────────────────────

const TENANT_SCOPED_MODELS = new Set([
  "Contact", "Conversation", "Message", "Document", "AuthSession",
  "Product", "Order", "SupportTicket", "ApiKey", "Webhook",
  "WhatsAppNumber", "Channel", "WidgetKey", "Connector",
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
          const tenantId = getCurrentTenantId();
          if (!tenantId || !model || !TENANT_SCOPED_MODELS.has(model)) return query(args);
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
            const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const modelClient = (base as any)[modelKey];
            const owned = await modelClient.findFirst({ where: { AND: [{ tenantId }, a.where] }, select: { id: true } });
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
