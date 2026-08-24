import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Temporary — deleted right after use. Read-only check for any Channel rows
// sharing the same (type, address) across different tenants, before adding
// a hard @@unique([type, address]) constraint to the schema.
export async function GET() {
  const channels = await db.channel.findMany({
    where: { address: { not: null } },
    select: { id: true, tenantId: true, type: true, address: true },
  });
  const seen = new Map<string, typeof channels>();
  for (const c of channels) {
    const key = `${c.type}::${c.address}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(c);
  }
  const duplicateGroups = [...seen.entries()].filter(([, rows]) => rows.length > 1);
  return NextResponse.json({ totalChannels: channels.length, duplicateGroups });
}
