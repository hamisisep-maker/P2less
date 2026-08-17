/**
 * Idempotent reconciliation: ensure every tenant's "owner" role has ALL current
 * permissions. Existing Role rows are frozen at seed-time — adding a new key to
 * PERMISSIONS in code does NOT retroactively update already-created roles, so
 * without this, a brand-new permission (like products.manage) silently locks
 * out existing owners until a fresh reseed. Safe to re-run anytime; called on
 * every boot in prod-start.mjs so this never needs a manual fix again.
 */
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS } from "../src/lib/permissions";

const db = new PrismaClient();

async function main() {
  const all = Object.values(PERMISSIONS);
  const owners = await db.role.findMany({ where: { key: "owner" } });
  let updated = 0;
  for (const role of owners) {
    const current = new Set((role.permissions as string[] | null) ?? []);
    const missing = all.filter((p) => !current.has(p));
    if (missing.length === 0) continue;
    await db.role.update({ where: { id: role.id }, data: { permissions: [...current, ...missing] } });
    updated++;
  }
  console.log(`[sync-owner-permissions] ${updated}/${owners.length} owner role(s) updated.`);
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
