// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 9 (2026-08-20, resumed 2026-08-21) — see
// docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md. Meta's "Meta-hosted Embedded
// Signup" — the org clicks a link, Meta hosts the entire WABA-creation UI on
// business.facebook.com, then redirects back with a standard OAuth
// authorization code. This is the SIMPLER of Meta's two Embedded Signup
// variants (the other requires embedding Meta's JS SDK popup and reading its
// postMessage payload) — we only need a link + a server-side callback.
//
// The redirect-back contract (code, state → exchange for an access token) is
// standard Meta/Facebook OAuth, documented and confirmed via Meta's own docs.
// What is NOT yet confirmed by real testing: exactly which webhook event
// (account_update field, some `event` value) fires to tell us the resulting
// WABA id / phone_number_id — Meta's docs describe this mechanism for the
// JS-SDK variant (a direct postMessage) but the hosted-redirect variant used
// here has no JS channel back to the page that opened it, so account_update
// webhooks are the only place left to learn this. Genuinely unverified until
// a real client completes the flow — see the webhook route's account_update
// handler for the honest "log everything until we've seen a real one" stance.
// ─────────────────────────────────────────────────────────────────────────────

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

function appId(): string | null {
  return process.env.WHATSAPP_APP_ID || null;
}

function appSecret(): string | null {
  return process.env.WHATSAPP_APP_SECRET || null;
}

function configId(): string | null {
  return process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || null;
}

function redirectUri(): string | null {
  return process.env.WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI || null;
}

export function embeddedSignupConfigured(): boolean {
  return !!(appId() && appSecret() && configId() && redirectUri());
}

/** The link an org clicks to connect their own WhatsApp number. `state` round-trips
 *  through Meta's redirect unchanged — carries the tenant id so the callback knows
 *  which tenant to attach the resulting WABA/number to (this is a real CSRF/binding
 *  control, not just a convenience: without it, the callback would have no way to
 *  know who the "code" belongs to). */
export function buildEmbeddedSignupLink(state: string): { ok: true; url: string } | { ok: false; error: string } {
  const id = appId();
  const cfg = configId();
  const redirect = redirectUri();
  if (!id || !cfg || !redirect) {
    return { ok: false, error: "WhatsApp Embedded Signup isn't configured yet (WHATSAPP_APP_ID / WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID / WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI)." };
  }
  const extras = JSON.stringify({ version: "v4", sessionInfoVersion: "3", featureType: "whatsapp_business_app_onboarding" });
  const url = `https://business.facebook.com/messaging/whatsapp/onboard/?app_id=${encodeURIComponent(id)}&config_id=${encodeURIComponent(cfg)}&extras=${encodeURIComponent(extras)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`;
  return { ok: true, url };
}

export type TokenExchangeResult =
  | { ok: true; accessToken: string; expiresIn?: number }
  | { ok: false; error: string };

/** Standard Meta/Facebook OAuth authorization-code exchange — confirmed against
 *  Meta's own Facebook Login documentation (GET /oauth/access_token with
 *  client_id + client_secret + redirect_uri + code). The redirect_uri passed
 *  here MUST be byte-identical to the one used when generating the signup link
 *  and to the one registered on the config — Meta rejects a mismatch. */
export async function exchangeCodeForToken(code: string): Promise<TokenExchangeResult> {
  const id = appId();
  const secret = appSecret();
  const redirect = redirectUri();
  if (!id || !secret || !redirect) {
    return { ok: false, error: "WhatsApp Embedded Signup isn't fully configured (missing app id/secret/redirect uri)." };
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&redirect_uri=${encodeURIComponent(redirect)}&code=${encodeURIComponent(code)}`;
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.access_token) {
      const message = body?.error?.message || `Token exchange failed (${res.status})`;
      return { ok: false, error: message };
    }
    return { ok: true, accessToken: body.access_token as string, expiresIn: body.expires_in as number | undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Token exchange request failed." };
  }
}
