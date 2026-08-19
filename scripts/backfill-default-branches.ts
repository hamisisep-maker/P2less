// Idempotent: gives every existing tenant exactly one isDefault:true Branch
// named "Main" so Phase 2 (branch-scoped permissions/routing) has something to
// attach to without an admin having to set anything up first. Never touches a
// tenant that already has a branch. Safe to re-run (dev, or via `railway ssh`
// against production) any number of times.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const tenants = await db.tenant.findMany({ select: { id: true, name: true } });
  let created = 0;
  for (const t of tenants) {
    const existing = await db.branch.findFirst({ where: { tenantId: t.id } });
    if (existing) {
      console.log(`- ${t.name}: already has a branch, skipping`);
      continue;
    }
    await db.branch.create({
      data: { tenantId: t.id, name: "Main", kind: "branch", isDefault: true },
    });
    console.log(`✓ ${t.name}: created default "Main" branch`);
    created++;
  }
  console.log(`\n${created}/${tenants.length} tenant(s) backfilled.`);
}

main().finally(() => db.$disconnect());
