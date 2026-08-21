import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exchangeCodeForPages, saveConnectedPage } from "@/lib/messenger";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8a — Meta redirects here after an org authorizes Facebook Login for
// Messenger. Standard OAuth shape: ?code=...&state=... on success,
// ?error=...&error_description=... if the org cancelled or Meta rejected it.
// Same pattern as the WhatsApp Embedded Signup callback (route.ts alongside
// this one at src/app/api/whatsapp/embedded-signup/callback), simpler flow.
//
// v1 scope: if the org manages multiple Pages, connects the FIRST one
// returned rather than offering a picker — Channel's @@unique([tenantId,
// type]) only fits one Messenger Page per tenant anyway today. A real,
// stated limitation, not an oversight.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (oauthError) {
    redirect(`/dashboard/messenger?connect=error&message=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !state) {
    redirect(`/dashboard/messenger?connect=error&message=${encodeURIComponent("Meta didn't return the expected authorization code.")}`);
  }

  const tenant = await db.tenant.findUnique({ where: { id: state } });
  if (!tenant) {
    redirect(`/dashboard/messenger?connect=error&message=${encodeURIComponent("Couldn't match this connection back to an organization.")}`);
  }

  const result = await exchangeCodeForPages(code);
  if (!result.ok) {
    redirect(`/dashboard/messenger?connect=error&message=${encodeURIComponent(result.error)}`);
  }
  if (result.pages.length === 0) {
    redirect(`/dashboard/messenger?connect=error&message=${encodeURIComponent("No Facebook Pages found for that account — connect an account that manages at least one Page.")}`);
  }

  await saveConnectedPage(tenant.id, result.pages[0]);
  redirect("/dashboard/messenger?connect=success");
}
