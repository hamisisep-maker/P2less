/**
 * Regression test for the /admin/tickets/[id] production bug (2026-09-03)
 * and the 2026-09-04 audit sweep that found the same pattern in three more
 * places: that page resolved ticket.tenantId with `db.supportTicket.
 * findUnique({ where: { id } })` BEFORE any tenant context existed — the
 * one query the 4089820 tenant-scoping fix missed converting in that file.
 * Under the fail-closed extension (src/lib/db.ts) that's a hard
 * TenantContextMissingError on every single call, confirmed live against a
 * real Phase 5 pilot ticket. Fixed by wrapping the lookup in
 * runCrossTenant(), the same "resolve identity before any permission
 * context exists" pattern actions.ts's loginAction() already uses.
 *
 * A deliberate audit sweep of every /admin/** page and *-actions.ts file
 * (docs/... — see the commit this test file was extended in) found the
 * identical bug in three more call sites, all sharing the same root cause
 * (a lookup used to resolve a permission-check's tenantId, running before
 * that permission check enters any context): ticket-actions.ts's
 * loadTicketOrError() (used by 11 exported ticket actions), that same
 * file's linkPaymentAction/linkMessageAction (each has ANOTHER unwrapped
 * lookup after loadTicketOrError), and admin-actions.ts's
 * refundPaymentAction (also reachable via POST /api/admin/billing/refund).
 * All four fixed with the same runCrossTenant() wrap.
 *
 * This exercises the REAL extension in src/lib/db.ts directly (not a
 * reimplementation) against real rows, proving:
 *   1. The fail-closed default itself is intact for every tenant-scoped
 *      model touched by today's fixes (SupportTicket, Payment, Message) —
 *      an unscoped, non-cross-tenant query still throws for each.
 *      (Regressing this back to fail-open would "fix" the symptom by
 *      reintroducing the exact outage db.ts's own history describes.)
 *   2. runCrossTenant() — the fix's mechanism — resolves a row by id
 *      regardless of which tenant owns it, for each of those models, which
 *      is what every fixed call site needs to even learn the tenantId to
 *      check permission against.
 *   3. Once a tenant's context is entered, the SAME ticket is still
 *      reachable by its owning tenant (the normal post-permission-check
 *      path isn't broken by the fix).
 *   4. Cross-tenant access is still denied: entering a DIFFERENT tenant's
 *      context and querying that same ticket id returns null, not the row.
 *
 * No dev server required — pure data-layer test.
 *   npx tsx scripts/test-tenant-scoping.ts
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db } from "../src/lib/db";
import { enterTenantContext, runCrossTenant } from "../src/lib/tenant-context";

const CHECK_NO_CONTEXT_SCRIPT = fileURLToPath(new URL("./_check-no-tenant-context.ts", import.meta.url));

let passed = 0, failed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${detail ? "→ " + detail : ""}`); }
}

// Spawns _check-no-tenant-context.ts as a FRESH process for the given
// model/id — has to be a separate process because this process's own
// runCrossTenant() calls (resolving the seed tenants, creating test rows)
// leave tenant-context.ts's ambient enterWith() storage permanently in
// cross-tenant mode, so "no context at all" can't be observed here anymore.
function checkNoContextThrows(model: "supportTicket" | "payment" | "message", id: string): boolean {
  try {
    // shell: true because "npx" resolves to npx.cmd on Windows, which
    // execFileSync can't exec directly without a shell. `id` is always a
    // freshly cuid()-generated internal id, never user input, so the
    // "arguments aren't escaped" deprecation warning this triggers is
    // noise here, not a real injection surface.
    execFileSync("npx", ["tsx", "--conditions=react-server", CHECK_NO_CONTEXT_SCRIPT, model, id], { stdio: "pipe", shell: true });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("Tenant-scoping regression — /admin/tickets/[id]'s pre-permission ticket lookup\n");

  const tenantA = await runCrossTenant(() => db.tenant.findUnique({ where: { slug: "riverside" } }));
  const tenantB = await runCrossTenant(() => db.tenant.findUnique({ where: { slug: "hamzone" } }));
  if (!tenantA || !tenantB) throw new Error("Seed tenants 'riverside'/'hamzone' not found — run the seed script first.");

  const ticket = await runCrossTenant(() =>
    db.supportTicket.create({
      data: { tenantId: tenantA.id, subject: "Tenant-scoping regression test ticket", source: "internal" },
    }),
  );

  try {
    // 1. Fail-closed default is still real: no context at all still throws,
    // not a silent unscoped read. This is the invariant the fix must NOT
    // weaken — see db.ts's own history of a real outage from fail-open. Run
    // in a FRESH child process: this process has already called
    // runCrossTenant() above, and tenant-context.ts's enterWith()-based
    // storage is ambient and never pops back to "no context" — see that
    // file's own comment on why enterWith() (not storage.run()) is used.
    check("no tenant context at all still throws TenantContextMissingError (fail-closed preserved)", checkNoContextThrows("supportTicket", ticket.id));

    // 2. The fix's actual mechanism: runCrossTenant() resolves the ticket by
    // id with no tenant filter — exactly what page.tsx needs to learn which
    // tenant to check permission against, before that permission check has
    // run.
    const resolved = await runCrossTenant(() => db.supportTicket.findUnique({ where: { id: ticket.id } }));
    check("runCrossTenant() resolves the ticket regardless of which tenant owns it", resolved?.id === ticket.id);

    // 3. Once the owning tenant's context is entered (what withAdminPermission
    // does next, in the real page), the ticket is still reachable normally —
    // the fix doesn't break the ordinary scoped-success path.
    enterTenantContext(tenantA.id);
    const ownTenantRead = await db.supportTicket.findUnique({ where: { id: ticket.id } });
    check("the ticket's own tenant can still read it normally after context is entered", ownTenantRead?.id === ticket.id);

    // 4. Cross-tenant access is still denied: a DIFFERENT tenant's context
    // must not be able to read this ticket by id.
    enterTenantContext(tenantB.id);
    const otherTenantRead = await db.supportTicket.findUnique({ where: { id: ticket.id } });
    check("a different tenant's context cannot read another tenant's ticket by id", otherTenantRead === null);
  } finally {
    await runCrossTenant(() => db.supportTicket.delete({ where: { id: ticket.id } }));
  }

  // Same audit sweep, Payment: admin-actions.ts's refundPaymentAction() and
  // ticket-actions.ts's linkPaymentAction() both had their own unwrapped
  // db.payment lookup before their permission check — fixed with the same
  // runCrossTenant() wrap. Only the two checks that matter beyond what's
  // already proven generically above: this model really is fail-closed
  // (not accidentally missing from TENANT_SCOPED_MODELS), and
  // runCrossTenant() resolves it regardless of tenant, same as SupportTicket.
  const payment = await runCrossTenant(() =>
    db.payment.create({ data: { tenantId: tenantA.id, reference: `tenant-scoping-test-${Date.now()}`, amount: 1 } }),
  );
  try {
    check("Payment: no tenant context at all still throws TenantContextMissingError", checkNoContextThrows("payment", payment.id));
    const resolvedPayment = await runCrossTenant(() => db.payment.findUnique({ where: { id: payment.id } }));
    check("Payment: runCrossTenant() resolves it regardless of which tenant owns it", resolvedPayment?.id === payment.id);
  } finally {
    await runCrossTenant(() => db.payment.delete({ where: { id: payment.id } }));
  }

  // Same audit sweep, Message: ticket-actions.ts's linkMessageAction() had
  // its own unwrapped db.message lookup before its permission check.
  const contact = await runCrossTenant(() =>
    db.contact.create({ data: { tenantId: tenantA.id, channelType: "whatsapp", address: `+1555${Date.now()}`.slice(0, 15), displayName: "Tenant-scoping test contact" } }),
  );
  const conversation = await runCrossTenant(() => db.conversation.create({ data: { tenantId: tenantA.id, contactId: contact.id } }));
  const message = await runCrossTenant(() =>
    db.message.create({ data: { tenantId: tenantA.id, conversationId: conversation.id, direction: "in", body: "Tenant-scoping test message" } }),
  );
  try {
    check("Message: no tenant context at all still throws TenantContextMissingError", checkNoContextThrows("message", message.id));
    const resolvedMessage = await runCrossTenant(() => db.message.findUnique({ where: { id: message.id } }));
    check("Message: runCrossTenant() resolves it regardless of which tenant owns it", resolvedMessage?.id === message.id);
  } finally {
    await runCrossTenant(() => db.message.delete({ where: { id: message.id } }));
    await runCrossTenant(() => db.conversation.delete({ where: { id: conversation.id } }));
    await runCrossTenant(() => db.contact.delete({ where: { id: contact.id } }));
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed) console.log(`Failed: ${fails.join(", ")}`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
