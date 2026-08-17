import { requireKey, unauthorized } from "@/lib/demo-auth";
import { db } from "@/lib/db";

// DEMO EXTERNAL SYSTEM: Kilimani Retail order management.
export async function GET(req: Request, { params }: { params: Promise<{ orderRef: string }> }) {
  if (!requireKey(req, process.env.DEMO_BUSINESS_API_KEY || "")) return unauthorized();
  const { orderRef } = await params;
  const order = await db.demoOrder.findUnique({ where: { reference: orderRef } });
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  return Response.json({
    reference: order.reference,
    item: order.item,
    status: order.status,
    eta: order.eta,
  });
}
