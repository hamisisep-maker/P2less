/**
 * Child process for scripts/test-tenant-scoping.ts's check #1. Has to run
 * in its OWN fresh process: tenant-context.ts's AsyncLocalStorage uses
 * enterWith() (ambient, never popped — see that file's own comment on why),
 * so once any runCrossTenant()/enterTenantContext() call happens anywhere
 * in a process, "no context at all" can no longer be observed in that same
 * process. This file's only job is to make exactly ONE db call, with zero
 * tenant-context calls before it, and report whether it threw
 * TenantContextMissingError.
 */
import { db, TenantContextMissingError } from "../src/lib/db";

const ticketId = process.argv[2];

db.supportTicket
  .findUnique({ where: { id: ticketId } })
  .then(async () => {
    await db.$disconnect();
    process.exit(1); // did NOT throw — fail-closed default is broken
  })
  .catch(async (e) => {
    await db.$disconnect();
    process.exit(e instanceof TenantContextMissingError ? 0 : 1);
  });
