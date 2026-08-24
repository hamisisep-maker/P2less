import { withTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Poll a payment's status by reference (used by the billing UI after STK push).
export async function GET(req: Request) {
  return withTenantUser(async (user) => {
    const ref = new URL(req.url).searchParams.get("ref");
    if (!ref) return Response.json({ error: "ref required" }, { status: 400 });
    const payment = await db.payment.findFirst({ where: { reference: ref, tenantId: user.tenantId! } });
    if (!payment) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ status: payment.status, amount: payment.amount, currency: payment.currency });
  });
}
