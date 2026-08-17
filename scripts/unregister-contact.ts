/**
 * Fully remove a phone's contact identity on one tenant, so the NEXT message
 * from that number is treated as a genuine first-time, unregistered user — the
 * real "unknown contact" welcome + self-service onboarding flow, not a shortcut.
 * (You can't get a second real WhatsApp test number easily on Meta's free tier,
 * so this simulates a brand-new sender on the SAME live number.)
 *
 * Usage: npx tsx scripts/unregister-contact.ts <tenantSlug> <phone>
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const [slug, phoneArg] = process.argv.slice(2);
  if (!slug || !phoneArg) { console.error("Usage: npx tsx scripts/unregister-contact.ts <tenantSlug> <phone>"); process.exit(1); }
  const phone = phoneArg.startsWith("+") ? phoneArg : "+" + phoneArg.replace(/[^\d]/g, "");

  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant) { console.error(`No tenant "${slug}"`); process.exit(1); }
  const contact = await db.contact.findFirst({ where: { tenantId: tenant.id, address: phone } });
  if (!contact) { console.log(`${phone} has no record on ${tenant.name} — already unregistered.`); await db.$disconnect(); return; }

  // Document doesn't cascade-delete from Contact — clear those first.
  await db.document.deleteMany({ where: { contactId: contact.id } });
  // Everything else (roles, conversations, OTPs, auth sessions, payments) cascades.
  await db.contact.delete({ where: { id: contact.id } });

  console.log(`✓ ${phone} is now fully unregistered on ${tenant.name} — the next message will trigger the real first-time welcome + onboarding flow.`);
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
