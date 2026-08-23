import "server-only";
import crypto from "node:crypto";

// -----------------------------------------------------------------------------
// Hash-chaining for AuditLog and PlatformAuditLog (2026-08-23/24 security
// review -- "you are selling evidence about your own behaviour while being
// the only party with write access to it... in SQLite, append-only is a
// convention, not a guarantee -- there's no UPDATE you can't run"). The
// cheapest credible fix per that same review: each row's hash covers its own
// content AND the previous row's hash, so a row edited or deleted after the
// fact breaks the chain from that point forward -- detectable by
// verifyAuditChain()/verifyPlatformAuditChain(), not just assumed intact.
//
// Does NOT anchor the chain head anywhere outside this database (the
// review's own suggested next step -- a daily digest emailed to the client,
// or published externally) -- that's real, valuable, further work, not
// attempted here. Without it, someone with write access to the whole
// database could still rewrite a full chain end-to-end and recompute
// consistent hashes; what this DOES catch is a partial edit (a single row
// changed, rows deleted from the middle) that doesn't also silently
// re-chain everything after it -- the realistic tamper case, not a
// hypothetical fully-sophisticated attacker with unlimited time.
// -----------------------------------------------------------------------------

export const CHAIN_GENESIS = "genesis";

export type ChainableFields = {
  tenantId?: string;
  requestId?: string;
  actorType?: string;
  actorId?: string | null;
  actorEmail?: string;
  action: string;
  target?: string | null;
  success?: boolean;
  detail?: unknown;
  role?: string | null;
  permission?: string | null;
  reason?: string | null;
  ip?: string | null;
  createdAtIso: string;
};

// A control-character join separator (charCode 1), not "" -- avoids the
// classic canonicalization ambiguity where two different field splits
// ("ab","c" vs "a","bc") would otherwise hash identically under plain
// concatenation.
const CHAIN_SEP = String.fromCharCode(1);

/** Deterministic hash of one entry's own content, chained to the previous
 *  entry's hash -- explicit field list and order (not object-key iteration,
 *  which isn't guaranteed stable enough to rely on for this). */
export function chainHash(prevHash: string, entry: ChainableFields): string {
  const parts = [
    prevHash,
    entry.tenantId ?? "",
    entry.requestId ?? "",
    entry.actorType ?? "",
    entry.actorId ?? "",
    entry.actorEmail ?? "",
    entry.action,
    entry.target ?? "",
    entry.success === undefined ? "" : String(entry.success),
    JSON.stringify(entry.detail ?? null),
    entry.role ?? "",
    entry.permission ?? "",
    entry.reason ?? "",
    entry.ip ?? "",
    entry.createdAtIso,
  ];
  return crypto.createHash("sha256").update(parts.join(CHAIN_SEP)).digest("hex");
}

export type ChainVerifyResult = { ok: boolean; checked: number; brokenAt?: { id: string; createdAt: Date } };
