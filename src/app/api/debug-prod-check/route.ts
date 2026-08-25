import { db } from "@/lib/db";

// TEMPORARY — verifies real production data before a schema migration that
// adds new unique constraints (Invoice.normalizedInvoiceNumber,
// Payment.[provider,providerRef]). Deleted immediately after use.
export async function GET() {
  const dupes = await db.$queryRawUnsafe(`
    SELECT provider, providerRef, COUNT(*) as cnt FROM Payment
    WHERE providerRef IS NOT NULL GROUP BY provider, providerRef HAVING COUNT(*) > 1;
  `);
  const invoiceCount = await db.invoice.count();
  return Response.json({ duplicateProviderRefPairs: dupes, invoiceCount });
}
