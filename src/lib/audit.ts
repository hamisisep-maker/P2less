import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { CHAIN_GENESIS, chainHash, type ChainVerifyResult } from "./audit-chain";

export type AuditInput = {
  tenantId: string;
  requestId: string;
  actorType: "contact" | "user" | "system";
  actorId?: string | null;
  action: string;
  target?: string | null;
  success: boolean;
  detail?: Record<string, unknown>;
  // RBAC context — populated when a platform admin performed this via
  // requireAdminPermission/logPrivilegedAction (admin-authz.ts).
  role?: string | null;
  permission?: string | null;
  reason?: string | null;
  ip?: string | null;
};

// Keys that must never land in the audit trail even if a caller passes them.
const REDACT = /(password|secret|token|apikey|api_key|authorization|pin|otp|code)/i;

// Exported so logPrivilegedAction (admin-authz.ts) can apply the SAME
// redaction to PlatformAuditLog — it used to skip this, an inconsistency
// found in the Priority 6 system audit (credential-rotation-style detail
// payloads could land there unredacted even though the tenant-scoped
// AuditLog copy of the same action was always sanitized).
export function sanitize(detail?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (REDACT.test(k)) {
      out[k] = "[redacted]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = v.slice(0, 500) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    const createdAt = new Date();
    const detail = sanitize(input.detail);
    // Hash-chain (2026-08-23/24 security review) — read-then-write inside a
    // real transaction so concurrent audit() calls for the same tenant can
    // never both read the same "previous" row and fork the chain; SQLite
    // serializes concurrent write transactions, so the second one to commit
    // correctly sees the first one's row. See audit-chain.ts's own comment
    // for what this does and doesn't defend against.
    await db.$transaction(async (tx) => {
      const last = await tx.auditLog.findFirst({ where: { tenantId: input.tenantId }, orderBy: { createdAt: "desc" } });
      const prevHash = last?.hash ?? CHAIN_GENESIS;
      const hash = chainHash(prevHash, {
        tenantId: input.tenantId,
        requestId: input.requestId,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        target: input.target ?? null,
        success: input.success,
        detail,
        role: input.role ?? null,
        permission: input.permission ?? null,
        reason: input.reason ?? null,
        ip: input.ip ?? null,
        createdAtIso: createdAt.toISOString(),
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          requestId: input.requestId,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          target: input.target ?? null,
          success: input.success,
          detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined,
          role: input.role ?? null,
          permission: input.permission ?? null,
          reason: input.reason ?? null,
          ip: input.ip ?? null,
          createdAt,
          prevHash,
          hash,
        },
      });
    });
  } catch {
    // Auditing must never break the request path; failures are swallowed but
    // would surface in observability in production.
  }
}

/** Walks one tenant's AuditLog chain in order, recomputing each row's hash
 *  from its own stored fields and confirming it both matches the stored
 *  `hash` AND correctly chains from the previous row's `hash`. Starts from
 *  the first HASHED row (skips any that predate this feature, per the
 *  schema's own comment) — a partial chain is still fully verifiable from
 *  that point forward. Read-only; never called on the hot path. */
export async function verifyAuditChain(tenantId: string): Promise<ChainVerifyResult> {
  const rows = await db.auditLog.findMany({ where: { tenantId, hash: { not: null } }, orderBy: { createdAt: "asc" } });
  let expectedPrev = rows[0]?.prevHash ?? CHAIN_GENESIS;
  let checked = 0;
  for (const row of rows) {
    const recomputed = chainHash(row.prevHash ?? CHAIN_GENESIS, {
      tenantId: row.tenantId,
      requestId: row.requestId,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      target: row.target,
      success: row.success,
      detail: row.detail,
      role: row.role,
      permission: row.permission,
      reason: row.reason,
      ip: row.ip,
      createdAtIso: row.createdAt.toISOString(),
    });
    if (row.prevHash !== expectedPrev || recomputed !== row.hash) {
      return { ok: false, checked, brokenAt: { id: row.id, createdAt: row.createdAt } };
    }
    expectedPrev = row.hash!;
    checked++;
  }
  return { ok: true, checked };
}
