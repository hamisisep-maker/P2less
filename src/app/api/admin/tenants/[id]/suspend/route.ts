import { NextResponse } from "next/server";
import { assertAdminPermission, ForbiddenError } from "@/lib/admin-authz";
import { suspendTenantAction } from "@/lib/admin-actions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const suspend = body.suspend !== false; // default true (suspend) unless explicitly {suspend:false}
  const reason = typeof body.reason === "string" ? body.reason : "";
  try {
    await assertAdminPermission(suspend ? "tenants.suspend" : "tenants.reactivate", { tenantId: id });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
  const result = await suspendTenantAction(id, suspend, reason);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
