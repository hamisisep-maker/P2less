import "server-only";
import { db } from "./db";
import { encryptJSON, decryptJSON } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 8a (scoped 2026-08-20, built 2026-08-21) —
// see docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md. Facebook Messenger reply
// channel — Mode 1 (the customer messages first) extended beyond WhatsApp.
//
// Reuses the SAME Meta App as WhatsApp (App ID/Secret) — confirmed live
// against the real app dashboard, no separate app or Business Verification
// needed. Standard Facebook Login OAuth (NOT a special "Embedded Signup"
// like WhatsApp needs) — an org connects their own Page, we get a Page
// Access Token via the well-documented /me/accounts pattern.
//
// Genuinely dev-mode-testable right now: pages_messaging, pages_show_list,
// and pages_manage_metadata are all "Ready for testing" on the real app
// (confirmed 2026-08-21), no App Review needed until onboarding a client
// Page this Meta developer account doesn't itself manage.
// ─────────────────────────────────────────────────────────────────────────────

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0"; // same Graph API, same version knob

function appId(): string | null {
  return process.env.WHATSAPP_APP_ID || null; // same Meta App as WhatsApp/Embedded Signup
}
function appSecret(): string | null {
  return process.env.WHATSAPP_APP_SECRET || null;
}
function redirectUri(): string | null {
  return process.env.MESSENGER_OAUTH_REDIRECT_URI || null;
}

export function messengerConnectConfigured(): boolean {
  return !!(appId() && appSecret() && redirectUri());
}

/** The link an org clicks to connect their own Facebook Page. `state` = tenant
 *  id, round-trips through Meta's redirect unchanged (same CSRF/binding role
 *  as the Embedded Signup link's `state`). Standard Facebook Login dialog —
 *  scopes are exactly the three permissions confirmed "Ready for testing". */
// Phase 8c (2026-08-22) adds pages_manage_posts + the Instagram publishing
// trio to the SAME connect link rather than a second OAuth flow — one
// connection covers Messenger DMs (8a) and product auto-publish (8c),
// matching the roadmap's own recorded plan. Requesting the permission here
// does NOT mean anything auto-publishes: that stays behind an explicit
// per-tenant toggle (see social-publish.ts) so a Page connected purely for
// messaging doesn't suddenly start posting to its public feed.
export function buildMessengerConnectLink(state: string): { ok: true; url: string } | { ok: false; error: string } {
  const id = appId();
  const redirect = redirectUri();
  if (!id || !redirect) {
    return { ok: false, error: "Messenger connection isn't configured yet (WHATSAPP_APP_ID / MESSENGER_OAUTH_REDIRECT_URI)." };
  }
  const scope = "pages_show_list,pages_messaging,pages_manage_metadata,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish";
  const url = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scope)}`;
  return { ok: true, url };
}

type PageAccount = { id: string; name: string; access_token: string };

/** code → short-lived user token → long-lived user token → the Pages that
 *  user manages, WITH each Page's own (long-lived, non-expiring by Meta's
 *  documented behavior when derived this way) access token. Three real
 *  Graph API calls, confirmed against Meta's own OAuth + Pages docs before
 *  writing this, not guessed. */
export async function exchangeCodeForPages(code: string): Promise<{ ok: true; pages: PageAccount[] } | { ok: false; error: string }> {
  const id = appId();
  const secret = appSecret();
  const redirect = redirectUri();
  if (!id || !secret || !redirect) return { ok: false, error: "Messenger connection isn't fully configured." };

  const tokenUrl = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&redirect_uri=${encodeURIComponent(redirect)}&code=${encodeURIComponent(code)}`;
  const tokenRes = await fetch(tokenUrl);
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenBody?.access_token) {
    return { ok: false, error: tokenBody?.error?.message || `Token exchange failed (${tokenRes.status})` };
  }
  const shortLived = tokenBody.access_token as string;

  const longUrl = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(shortLived)}`;
  const longRes = await fetch(longUrl);
  const longBody = await longRes.json().catch(() => ({}));
  const userToken = (longRes.ok && longBody?.access_token) ? (longBody.access_token as string) : shortLived; // fall back rather than fail the whole flow

  const pagesUrl = `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?access_token=${encodeURIComponent(userToken)}`;
  const pagesRes = await fetch(pagesUrl);
  const pagesBody = await pagesRes.json().catch(() => ({}));
  if (!pagesRes.ok || !Array.isArray(pagesBody?.data)) {
    return { ok: false, error: pagesBody?.error?.message || `Couldn't list Pages (${pagesRes.status})` };
  }
  const pages: PageAccount[] = pagesBody.data
    .filter((p: unknown): p is PageAccount => !!p && typeof p === "object" && "id" in p && "access_token" in p)
    .map((p: PageAccount) => ({ id: p.id, name: p.name, access_token: p.access_token }));
  return { ok: true, pages };
}

/** An Instagram Business Account is always linked TO a Facebook Page — this
 *  is the real Graph API field that exposes it, confirmed against Meta's own
 *  docs, not guessed. Best-effort: a Page with no linked Instagram account
 *  (the common case for a brand-new connection) just gets `null`, not an error. */
async function fetchLinkedInstagramAccount(pageId: string, pageToken: string): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(pageToken)}`);
    const body = await res.json().catch(() => ({}));
    return body?.instagram_business_account?.id ?? null;
  } catch {
    return null;
  }
}

/** Persists the connected Page as a real Channel row — reuses the SAME
 *  generic "channel resource" model the Registration Reframe work wired for
 *  WhatsApp (2026-08-21), not a new table. @@unique([tenantId, type]) means
 *  one Messenger Page per tenant today — a real v1 scope limit, not an
 *  oversight; an org with multiple Pages picks/reconnects to switch.
 *  `autoPublishEnabled` defaults false — Phase 8c's product auto-publish
 *  (social-publish.ts) stays opt-in even once the permission is granted. */
export async function saveConnectedPage(tenantId: string, page: PageAccount): Promise<void> {
  const instagramBusinessAccountId = await fetchLinkedInstagramAccount(page.id, page.access_token);
  // Reconnecting (e.g. to refresh a token) must NOT silently reset an
  // already-opted-in tenant's auto-publish choice back to off.
  const existing = await db.channel.findUnique({ where: { tenantId_type: { tenantId, type: "messenger" } } });
  const autoPublishEnabled = (existing?.config as { autoPublishEnabled?: boolean } | null)?.autoPublishEnabled ?? false;
  await db.channel.upsert({
    where: { tenantId_type: { tenantId, type: "messenger" } },
    create: { tenantId, type: "messenger", address: page.id, status: "active", config: { pageName: page.name, instagramBusinessAccountId, autoPublishEnabled, tokenEnc: encryptJSON({ accessToken: page.access_token }) } },
    update: { address: page.id, status: "active", config: { pageName: page.name, instagramBusinessAccountId, autoPublishEnabled, tokenEnc: encryptJSON({ accessToken: page.access_token }) } },
  });
}

/** Connecting a Page (OAuth) is necessary but NOT sufficient for messages to
 *  actually reach our webhook — Meta requires the Page to be explicitly
 *  subscribed to this app's webhook events, a separate real API call
 *  (confirmed via Meta's own Messenger Platform docs). Called right after
 *  saveConnectedPage() so every connection is fully wired automatically,
 *  not a manual dashboard step someone has to remember. */
export async function subscribePageToWebhook(pageId: string, pageAccessToken: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(pageAccessToken)}`,
    { method: "POST" },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) {
    return { ok: false, error: body?.error?.message || `Page subscription failed (${res.status})` };
  }
  return { ok: true };
}

export async function resolveMessengerToken(pageId: string): Promise<string | null> {
  const channel = await db.channel.findFirst({ where: { type: "messenger", address: pageId, status: "active" } });
  const cfg = channel?.config as { tokenEnc?: string } | null;
  const decrypted = decryptJSON<{ accessToken?: string }>(cfg?.tokenEnc);
  return decrypted?.accessToken ?? null;
}
