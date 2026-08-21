import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exchangeCodeForPages, saveConnectedPage, subscribePageToWebhook } from "@/lib/messenger";

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
    redirect(`/dashboard/channels?connect=error&message=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !state) {
    redirect(`/dashboard/channels?connect=error&message=${encodeURIComponent("Meta didn't return the expected authorization code.")}`);
  }

  const tenant = await db.tenant.findUnique({ where: { id: state } });
  if (!tenant) {
    redirect(`/dashboard/channels?connect=error&message=${encodeURIComponent("Couldn't match this connection back to an organization.")}`);
  }

  const result = await exchangeCodeForPages(code);
  if (!result.ok) {
    redirect(`/dashboard/channels?connect=error&message=${encodeURIComponent(result.error)}`);
  }
  if (result.pages.length === 0) {
    redirect(`/dashboard/channels?connect=error&message=${encodeURIComponent("No Facebook Pages found for that account — connect an account that manages at least one Page.")}`);
  }

  const page = result.pages[0];
  await saveConnectedPage(tenant.id, page);

  // The Page connection alone isn't enough for messages to reach the
  // webhook — Meta needs the Page explicitly subscribed. The Channel row
  // is already saved either way (a real connection, even if this specific
  // step needs retrying), so a subscription failure surfaces as a distinct
  // warning rather than pretending the whole thing failed.
  const sub = await subscribePageToWebhook(page.id, page.access_token);
  if (!sub.ok) {
    redirect(`/dashboard/channels?connect=partial&message=${encodeURIComponent("Page connected, but the webhook subscription failed: " + sub.error)}`);
  }

  redirect("/dashboard/channels?connect=success");
}
