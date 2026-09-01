import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const email = process.argv[2];
  const newPassword = process.argv[3];
  if (!email || !newPassword) {
    console.error("Usage: tsx scripts/reset-password.ts <email> <newPassword>");
    process.exit(1);
  }
  const passwordHash = await hashPassword(newPassword);
  const user = await db.user.update({ where: { email }, data: { passwordHash } });
  console.log(`Password reset for ${user.email} (tenantId: ${user.tenantId ?? "super admin"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
