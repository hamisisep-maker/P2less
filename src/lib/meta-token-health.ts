import "server-only";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

/** Real Graph API `debug_token` endpoint — confirmed against Meta's own docs
 *  (Phase 8c, when this check first shipped for Messenger Page tokens):
 *  `{app-id}|{app-secret}` is the documented "app access token" format,
 *  valid as the caller credential for inspecting ANY token issued to this
 *  same app — no per-tenant admin credential needed. Extracted here
 *  (2026-08-24) so the WhatsApp Cloud API token-health check added
 *  alongside it reuses the exact same proven implementation instead of a
 *  second hand-maintained copy of a reliability-critical check — the same
 *  "one implementation, not two" discipline already applied to the SSRF
 *  guard. */
export async function checkMetaAccessTokenValidity(token: string): Promise<{ valid: boolean; error?: string }> {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET; // same shared Meta App as WhatsApp/Messenger
  if (!appId || !appSecret) return { valid: true }; // can't check without app credentials — don't false-alarm every check for our own config gap
  try {
    const appToken = `${appId}|${appSecret}`;
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.data) return { valid: false, error: body?.error?.message || `debug_token failed (${res.status})` };
    return { valid: !!body.data.is_valid, error: body.data.error?.message };
  } catch (e) {
    return { valid: true, error: e instanceof Error ? e.message : "network error" }; // a network hiccup isn't evidence the token is bad — don't false-alarm on our own connectivity issue
  }
}
