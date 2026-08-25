import { db } from "./db";

type Source = "explore" | "settings" | "backfill";

/** Phase 4, 2026-08-26 — records exactly what changed in one field of a
 *  tenant's self-reported interest (useCases/channelsNeeded), not just the
 *  new snapshot. One row per value added/removed, so aggregate counts and
 *  history trends on the admin Product Intelligence dashboard are plain
 *  count()/groupBy() queries instead of parsing JSON arrays per tenant.
 *  Never throws — mirrors audit()'s "recording history must never break
 *  the request path" rule (src/lib/audit.ts). */
export async function recordInterestDiff(tenantId: string, field: "useCases" | "channelsNeeded", before: string[], after: string[], source: Source): Promise<void> {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((v) => !beforeSet.has(v));
  const removed = before.filter((v) => !afterSet.has(v));
  if (added.length === 0 && removed.length === 0) return;

  try {
    await db.tenantInterestEvent.createMany({
      data: [
        ...added.map((value) => ({ tenantId, source, field, value, action: "added" })),
        ...removed.map((value) => ({ tenantId, source, field, value, action: "removed" })),
      ],
    });
  } catch {
    // Recording history must never break the actual save.
  }
}
