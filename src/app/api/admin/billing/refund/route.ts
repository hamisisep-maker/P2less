import { NextResponse } from "next/server";
import { assertAdminPermission, ForbiddenError } from "@/lib/admin-authz";
import { refundPaymentAction } from "@/lib/admin-actions";

export async function POST(req: Request) {
  try {
    await assertAdminPermission("billing.refund");
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
  const body = await req.json().catch(() => ({}));
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const result = await refundPaymentAction(paymentId, reason);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
