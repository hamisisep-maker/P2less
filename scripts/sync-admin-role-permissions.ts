// Idempotent: updates ONLY the `permissions` JSON on each existing built-in
// AdminRole row to match src/lib/admin-permissions.ts's current BUILT_IN_ROLES
// — never touches users, tenants, or any other data. Run this after adding
// new permissions to an existing role so a live database (dev or production,
// via `railway ssh`) picks them up without a destructive reseed.
import { PrismaClient } from "@prisma/client";
import { BUILT_IN_ROLES } from "../src/lib/admin-permissions";

const db = new PrismaClient();

async function main() {
  for (const [key, def] of Object.entries(BUILT_IN_ROLES)) {
    const existing = await db.adminRole.findUnique({ where: { key } });
    if (!existing) {
      console.log(`- ${key} does not exist yet, skipping (run the full seed first)`);
      continue;
    }
    await db.adminRole.update({ where: { key }, data: { name: def.name, permissions: def.permissions } });
    console.log(`✓ ${key} synced (${def.permissions.length} permissions)`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
