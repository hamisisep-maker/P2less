import { db } from "@/lib/db";
import { assertAdminPermission, ForbiddenError } from "@/lib/admin-authz";
import { decryptJSON, encryptJSON, deriveKeyForRotation } from "@/lib/crypto";

// TEMPORARY — CREDENTIAL_KEY rotation migration (2026-08-24). Removed before
// the final commit of this round. Re-encrypts every real encrypted-at-rest
// row (Connector.authConfigEnc, Channel.config.tokenEnc) from the OLD key
// (current CREDENTIAL_KEY env value) to a NEW key supplied in the request
// body — never touches the CREDENTIAL_KEY env var itself, that's a separate,
// deliberate step taken only after this reports zero failures.
export async function POST(req: Request) {
  try {
    await assertAdminPermission("integrations.manage_credentials");
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ error: e.message }, { status: 403 });
    throw e;
  }

  const body = await req.json().catch(() => null) as { newKeyBase64?: string; dryRun?: boolean } | null;
  const newKeyBase64 = body?.newKeyBase64;
  if (!newKeyBase64) return Response.json({ error: "newKeyBase64 required" }, { status: 400 });
  const newKey = Buffer.from(newKeyBase64, "base64");
  if (newKey.length !== 32) return Response.json({ error: `newKeyBase64 must decode to exactly 32 bytes, got ${newKey.length}` }, { status: 400 });
  const dryRun = body?.dryRun === true;

  const oldKey = deriveKeyForRotation(process.env.CREDENTIAL_KEY || "");

  const results = {
    connectors: { total: 0, migrated: 0, failed: [] as string[] },
    channels: { total: 0, migrated: 0, failed: [] as string[] },
  };

  const connectors = await db.connector.findMany({ where: { authConfigEnc: { not: null } } });
  for (const c of connectors) {
    if (!c.authConfigEnc) continue;
    results.connectors.total++;
    const decrypted = decryptJSON(c.authConfigEnc, oldKey);
    if (decrypted === null) { results.connectors.failed.push(c.id); continue; }
    if (!dryRun) {
      const reEncrypted = encryptJSON(decrypted, newKey);
      await db.connector.update({ where: { id: c.id }, data: { authConfigEnc: reEncrypted } });
    }
    results.connectors.migrated++;
  }

  const channels = await db.channel.findMany({ where: { type: { in: ["messenger", "telegram"] } } });
  for (const ch of channels) {
    const config = ch.config as Record<string, unknown> | null;
    const tokenEnc = config?.tokenEnc as string | undefined;
    if (!tokenEnc) continue;
    results.channels.total++;
    const decrypted = decryptJSON(tokenEnc, oldKey);
    if (decrypted === null) { results.channels.failed.push(ch.id); continue; }
    if (!dryRun) {
      const reEncrypted = encryptJSON(decrypted, newKey);
      await db.channel.update({ where: { id: ch.id }, data: { config: { ...config, tokenEnc: reEncrypted } } });
    }
    results.channels.migrated++;
  }

  return Response.json({ ok: true, dryRun, results });
}
