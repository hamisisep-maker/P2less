/**
 * Connect a real WhatsApp Cloud API number to a tenant (or update an existing
 * registry row). Sets the phone_number_id P2Less routes on, and optionally the
 * public E.164 number and a per-number access token (encrypted at rest).
 *
 * Usage:
 *   npx tsx scripts/connect-number.ts <tenantSlug> <phoneNumberId> [phoneNumber] [accessToken]
 *
 * Example (point the seeded Hamzone row at your real Cloud API number):
 *   npx tsx scripts/connect-number.ts hamzone 123456789012345 +254711562526
 *
 * The token can also be provided globally via WHATSAPP_ACCESS_TOKEN in .env; pass
 * it here only if this number uses a different token than the platform default.
 */
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const db = new PrismaClient();

function encKey(): Buffer {
  const raw = process.env.CREDENTIAL_KEY || "";
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw || "p2less-dev-credential-key").digest();
}
function encryptJSON(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(value))), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

async function main() {
  const [slug, phoneNumberId, phoneNumber, accessToken] = process.argv.slice(2);
  if (!slug || !phoneNumberId) {
    console.error("Usage: npx tsx scripts/connect-number.ts <tenantSlug> <phoneNumberId> [phoneNumber] [accessToken]");
    process.exit(1);
  }
  const tenant = await db.tenant.findUnique({ where: { slug }, include: { numbers: true } });
  if (!tenant) { console.error(`No tenant with slug "${slug}".`); process.exit(1); }

  const existing = tenant.numbers[0];
  const webhookConfig = accessToken ? { enc: encryptJSON({ accessToken }) } : (existing?.webhookConfig ?? undefined);

  if (existing) {
    await db.whatsAppNumber.update({
      where: { id: existing.id },
      data: {
        phoneNumberId,
        phoneNumber: phoneNumber ?? existing.phoneNumber,
        webhookConfig: webhookConfig as object,
        status: "active",
        verificationStatus: "verified",
      },
    });
    console.log(`✓ Updated ${tenant.name}: phone_number_id=${phoneNumberId}${phoneNumber ? `, number=${phoneNumber}` : ""}${accessToken ? ", token stored (encrypted)" : ""}`);
  } else {
    await db.whatsAppNumber.create({
      data: {
        tenantId: tenant.id, phoneNumberId, phoneNumber: phoneNumber ?? phoneNumberId,
        displayName: tenant.name, status: "active", verificationStatus: "verified",
        webhookConfig: webhookConfig as object,
      },
    });
    console.log(`✓ Connected new number to ${tenant.name}.`);
  }
  console.log("  Inbound WhatsApp messages to this number will now route to this tenant.");
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
