import "server-only";
import { db } from "./db";

// Human-readable sequence numbers ("TCK-42", "INC-104") backed by
// PlatformSetting (already exists as exactly this — a platform-wide
// key/value store — so this doesn't need a dedicated counter table).
// Wrapped in a transaction: SQLite serializes concurrent writers, so a
// read-then-write here is safe at this app's admin-action scale without a
// retry loop.
export async function nextSequence(key: string): Promise<number> {
  return db.$transaction(async (tx) => {
    const existing = await tx.platformSetting.findUnique({ where: { key } });
    const next = (existing ? parseInt(existing.value, 10) || 0 : 0) + 1;
    await tx.platformSetting.upsert({
      where: { key },
      create: { key, value: String(next) },
      update: { value: String(next) },
    });
    return next;
  });
}

export async function nextTicketNumber(): Promise<string> {
  return `TCK-${await nextSequence("ticket_number_seq")}`;
}

export async function nextIncidentNumber(): Promise<string> {
  return `INC-${await nextSequence("incident_number_seq")}`;
}
