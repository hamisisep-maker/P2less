import { NextResponse } from "next/server";
import { assertAdminPermission, ForbiddenError } from "@/lib/admin-authz";
import { setPrimaryProviderAction } from "@/lib/admin-actions";

// Real backend endpoint (not just a Server Action) for one of the platform's
// most dangerous operations — lets this be exercised directly with a session
// cookie and no UI involved, proving the 403 is enforced server-side rather
// than by a hidden button. See admin-actions.ts's setPrimaryProviderAction
// for the actual mutation + audit write; this route is a thin, independently
// gated wrapper (assertAdminPermission runs here too, not just inside the action).
export async function POST(req: Request) {
  try {
    await assertAdminPermission("models.change_primary");
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
  const body = await req.json().catch(() => ({}));
  const provider = typeof body.provider === "string" ? body.provider : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const result = await setPrimaryProviderAction(provider, reason);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
