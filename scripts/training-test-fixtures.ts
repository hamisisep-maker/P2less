import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Small CLI of setup/teardown operations the hamzone-ai-training repo's
// cross-integration harness (scripts/test-cross-integration.ts, that repo)
// needs on THIS side but can't reach through the training HTTP routes
// themselves (issuing a credential, reading/setting a tenant's balance for
// the billing-gate scenario, cleaning up test tickets). Raw PrismaClient,
// not src/lib/db.ts — same "server-only" + tsx incompatibility as
// scripts/reset-password.ts, same fix.
//
// Usage: npx tsx scripts/training-test-fixtures.ts <command> [...args]
// Every command prints ONE line of JSON to stdout — the harness parses
// that line and nothing else, so don't add stray console.log calls here.
// ─────────────────────────────────────────────────────────────────────────────

const db = new PrismaClient();

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
function deriveKey(raw: string): Buffer {
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 32) return buf;
  return crypto.createHash("sha256").update(raw || "p2less-dev-credential-key").digest();
}
function encryptJSON(value: unknown): string {
  const k = deriveKey(process.env.CREDENTIAL_KEY || "");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

async function main() {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "create-credential": {
      const name = args[0] ?? "cross-integration-test";
      const apiKey = "hzt_test_" + crypto.randomBytes(16).toString("hex");
      const signingSecret = crypto.randomBytes(24).toString("base64url");
      const record = await db.trainingIntegrationCredential.create({
        data: {
          name,
          keyHash: sha256(apiKey),
          encryptedSigningSecret: encryptJSON({ secret: signingSecret }),
          scopes: ["training.evaluate", "training.findings"],
        },
      });
      console.log(JSON.stringify({ id: record.id, apiKey, signingSecret }));
      break;
    }
    case "revoke-credential": {
      const id = args[0];
      if (!id) throw new Error("usage: revoke-credential <id>");
      await db.trainingIntegrationCredential.delete({ where: { id } }).catch(() => {});
      console.log(JSON.stringify({ revoked: id }));
      break;
    }
    // Sets/clears revokedAt — the EXACT field and semantics the real
    // /admin/integrations kill-switch button touches
    // (src/lib/training-integration-actions.ts). Distinct from
    // revoke-credential above, which hard-deletes and is only for test
    // cleanup — these two exist to test the real disable/re-enable
    // behavior without destroying the row.
    case "disable-credential": {
      const id = args[0];
      if (!id) throw new Error("usage: disable-credential <id>");
      await db.trainingIntegrationCredential.update({ where: { id }, data: { revokedAt: new Date() } });
      console.log(JSON.stringify({ ok: true }));
      break;
    }
    case "enable-credential": {
      const id = args[0];
      if (!id) throw new Error("usage: enable-credential <id>");
      await db.trainingIntegrationCredential.update({ where: { id }, data: { revokedAt: null } });
      console.log(JSON.stringify({ ok: true }));
      break;
    }
    case "get-tenant-by-slug": {
      const slug = args[0];
      if (!slug) throw new Error("usage: get-tenant-by-slug <slug>");
      const tenant = await db.tenant.findUnique({ where: { slug } });
      if (!tenant) throw new Error(`No tenant with slug '${slug}'.`);
      console.log(JSON.stringify({ id: tenant.id, name: tenant.name }));
      break;
    }
    case "get-balance": {
      const tenantId = args[0];
      if (!tenantId) throw new Error("usage: get-balance <tenantId>");
      const sub = await db.subscription.findFirstOrThrow({ where: { tenantId } });
      console.log(JSON.stringify({ messageBalanceKes: sub.messageBalanceKes, aiBalanceKes: sub.aiBalanceKes }));
      break;
    }
    case "set-balance": {
      const [tenantId, messageBalanceKes, aiBalanceKes] = args;
      if (!tenantId || messageBalanceKes === undefined || aiBalanceKes === undefined) {
        throw new Error("usage: set-balance <tenantId> <messageBalanceKes> <aiBalanceKes>");
      }
      await db.subscription.updateMany({
        where: { tenantId },
        data: { messageBalanceKes: Number(messageBalanceKes), aiBalanceKes: Number(aiBalanceKes) },
      });
      console.log(JSON.stringify({ ok: true }));
      break;
    }
    case "count-tickets": {
      const findingId = args[0];
      if (!findingId) throw new Error("usage: count-tickets <trainingFindingId>");
      const count = await db.supportTicket.count({ where: { trainingFindingId: findingId } });
      console.log(JSON.stringify({ count }));
      break;
    }
    case "cleanup-tickets": {
      const prefix = args[0];
      if (!prefix) throw new Error("usage: cleanup-tickets <trainingFindingIdPrefix>");
      const tickets = await db.supportTicket.findMany({ where: { trainingFindingId: { startsWith: prefix } }, select: { id: true } });
      await db.ticketEvent.deleteMany({ where: { ticketId: { in: tickets.map((t) => t.id) } } });
      const deleted = await db.supportTicket.deleteMany({ where: { trainingFindingId: { startsWith: prefix } } });
      console.log(JSON.stringify({ deleted: deleted.count }));
      break;
    }
    default:
      throw new Error(`Unknown command '${command}'. Expected one of: create-credential, revoke-credential, disable-credential, enable-credential, get-tenant-by-slug, get-balance, set-balance, count-tickets, cleanup-tickets.`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
