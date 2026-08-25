import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exchangeCodeForToken } from "@/lib/whatsapp-embedded-signup";
import { enterTenantContext } from "@/lib/tenant-context";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 9 — Meta redirects here after an org
// completes Meta-hosted Embedded Signup (see startWhatsAppEmbeddedSignupAction
// in actions.ts for where the link is generated). Standard Meta/Facebook OAuth
// redirect shape: ?code=...&state=... on success, ?error=...&error_description=...
// if the org cancelled or Meta rejected the request.
//
// What this does NOT yet do: create or finalize the WhatsAppNumber row with a
// real wabaId/phoneNumberId. Meta's docs describe those asset ids arriving via
// a direct postMessage for the OTHER (JS-SDK popup) Embedded Signup variant —
// this hosted-redirect variant has no such channel, so the account_update
// webhook (see src/app/api/channels/whatsapp/webhook/route.ts) is the only
// place left to learn them, and the exact event shape there is genuinely
// unverified until a real org completes this flow. Exchanging the code here
// mainly confirms the handshake itself succeeded.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (oauthError) {
    redirect(`/dashboard/channels?embedded_signup=error&message=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !state) {
    redirect(`/dashboard/channels?embedded_signup=error&message=${encodeURIComponent("Meta didn't return the expected authorization code.")}`);
  }

  const tenant = await db.tenant.findUnique({ where: { id: state } });
  if (!tenant) {
    redirect(`/dashboard/channels?embedded_signup=error&message=${encodeURIComponent("Couldn't match this signup back to an organization.")}`);
  }
  // Tenant-isolation hardening audit, 2026-08-23 — same fix as the Messenger
  // OAuth callback: this route resolves a tenant but never established
  // context, unlike every other webhook/callback route in the codebase.
  enterTenantContext(tenant.id);

  const exchange = await exchangeCodeForToken(code);
  if (!exchange.ok) {
    redirect(`/dashboard/channels?embedded_signup=error&message=${encodeURIComponent(exchange.error)}`);
  }

  // Handshake succeeded. Mark (or create) a number for this tenant so it
  // shows up in the dashboard immediately, even though the real
  // wabaId/phoneNumberId aren't known yet — those get filled in once the
  // account_update webhook (or a later manual step) supplies them.
  //
  // 2026-08-25 — onboarding no longer pre-creates a WhatsAppNumber row (see
  // finalizeOnboarding, actions.ts), so "existing pending row" is no longer
  // a safe assumption: this is now the FIRST place a WhatsAppNumber can be
  // created for a tenant that connects WhatsApp after signup. The real
  // phoneNumber genuinely isn't known yet at this point — nullable, same
  // precedent Channel.address already established for "not yet connected."
  const existing = await db.whatsAppNumber.findFirst({ where: { tenantId: tenant.id } });
  if (existing) {
    await db.whatsAppNumber.update({ where: { id: existing.id }, data: { verificationStatus: "connecting" } });
  } else {
    await db.whatsAppNumber.create({
      data: { tenantId: tenant.id, phoneNumber: null, displayName: tenant.name, department: "General", status: "active", verificationStatus: "connecting" },
    });
    // .catch() only for the (tenantId, type) unique race — a genuinely
    // concurrent double-click; the WhatsAppNumber row above is the source
    // of truth either way.
    await db.channel.create({ data: { tenantId: tenant.id, type: "whatsapp", address: null, status: "active" } }).catch(() => {});
  }

  redirect("/dashboard/channels?embedded_signup=success");
}
