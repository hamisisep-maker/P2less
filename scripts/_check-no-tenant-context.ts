/**
 * Child process for scripts/test-tenant-scoping.ts's "no context at all"
 * checks. Has to run in its OWN fresh process: tenant-context.ts's
 * AsyncLocalStorage uses enterWith() (ambient, never popped — see that
 * file's own comment on why), so once any runCrossTenant()/
 * enterTenantContext() call happens anywhere in a process, "no context at
 * all" can no longer be observed in that same process. This file's only
 * job is to make exactly ONE db call, with zero tenant-context calls
 * before it, and report whether it threw TenantContextMissingError.
 *
 * Usage: tsx _check-no-tenant-context.ts <model> <id>, where <model> is
 * one of the lowerCamel Prisma client accessors (supportTicket, payment,
 * message, ...) for a tenant-scoped model.
 */
import { db, TenantContextMissingError } from "../src/lib/db";

const model = process.argv[2] as "supportTicket" | "payment" | "message";
const id = process.argv[3];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(db[model] as any)
  .findUnique({ where: { id } })
  .then(async () => {
    await db.$disconnect();
    process.exit(1); // did NOT throw — fail-closed default is broken
  })
  .catch(async (e: unknown) => {
    await db.$disconnect();
    process.exit(e instanceof TenantContextMissingError ? 0 : 1);
  });
