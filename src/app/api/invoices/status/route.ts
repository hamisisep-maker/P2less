import { withTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Poll an invoice's status by id (used by the upgrade modal after Paybill
// instructions are shown — Paybill has no synchronous "initiate" step to
// hand the client a Payment.reference to poll by, only the invoiceId).
export async function GET(req: Request) {
  return withTenantUser(async (user) => {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    // tenantId scoped IN the query itself — an invoice id alone is never
    // enough to read it, same as every other tenant-scoped resource here.
    const invoice = await db.invoice.findFirst({ where: { id, tenantId: user.tenantId! } });
    if (!invoice) return Response.json({ error: "not found" }, { status: 404 });
    // Real SUM query — the actual source of truth, never derived from the
    // latest payment or from payableKes minus something guessed.
    const paidSoFarKes = (await db.payment.aggregate({
      where: { invoiceId: id, status: "paid" }, _sum: { amount: true },
    }))._sum.amount ?? 0;
    return Response.json({ status: invoice.status, payableKes: invoice.payableKes, paidSoFarKes });
  });
}
