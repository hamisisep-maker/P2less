/**
 * Regression test for the /admin/tickets/[id] production bug (2026-09-03):
 * that page resolved ticket.tenantId with `db.supportTicket.findUnique({
 * where: { id } })` BEFORE any tenant context existed — the one query the
 * 4089820 tenant-scoping fix missed converting in that file. Under the
 * fail-closed extension (src/lib/db.ts) that's a hard TenantContextMissingError
 * on every single ticket detail page load, confirmed live against a real
 * Phase 5 pilot ticket. Fixed by wrapping that lookup in runCrossTenant(),
 * the same "resolve identity before any permission context exists" pattern
 * actions.ts's loginAction() already uses.
 *
 * This exercises the REAL extension in src/lib/db.ts directly (not a
 * reimplementation) against a real SupportTicket row, proving:
 *   1. The fail-closed default itself is intact — an unscoped, non-cross-
 *      tenant query still throws. (Regressing this back to fail-open would
 *      "fix" the symptom by reintroducing the exact outage db.ts's own
 *      history describes.)
 *   2. runCrossTenant() — the fix's mechanism — resolves a ticket by id
 *      regardless of which tenant owns it, which is what page.tsx needs to
 *      even learn the tenantId to check permission against.
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
    let childOk = false;
    try {
      // shell: true because "npx" resolves to npx.cmd on Windows, which
      // execFileSync can't exec directly without a shell. ticket.id is a
      // freshly cuid()-generated internal id, never user input, so the
      // "arguments aren't escaped" deprecation warning this triggers is
      // noise here, not a real injection surface.
      execFileSync("npx", ["tsx", "--conditions=react-server", CHECK_NO_CONTEXT_SCRIPT, ticket.id], { stdio: "pipe", shell: true });
      childOk = true;
    } catch {
      childOk = false;
    }
    check("no tenant context at all still throws TenantContextMissingError (fail-closed preserved)", childOk);

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
