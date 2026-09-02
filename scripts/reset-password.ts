// Raw PrismaClient, deliberately NOT the tenant-scoped `db` export from
// src/lib/db.ts — that wrapper requires an AsyncLocalStorage tenant context
// (throws TenantContextMissingError otherwise) and pulls in tenant-context.ts,
// which imports the `server-only` marker package. Neither applies to a
// standalone maintenance script; prisma/seed.ts uses this exact same raw
// PrismaClient pattern for the same reason.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const newPassword = process.argv[3];
  if (!email || !newPassword) {
    console.error("Usage: tsx scripts/reset-password.ts <email> <newPassword>");
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const user = await db.user.update({ where: { email }, data: { passwordHash } });
  console.log(`Password reset for ${user.email} (tenantId: ${user.tenantId ?? "super admin"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
