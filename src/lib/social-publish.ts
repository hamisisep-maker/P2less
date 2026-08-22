import "server-only";
import { db } from "./db";
import { decryptJSON } from "./crypto";
import { queueNotification } from "./notifications";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 8c — auto-publish new products to the
// org's own connected Facebook Page + Instagram Business account. Zero
// ongoing human login after the one-time connection (reused from Phase 8a's
// Messenger OAuth, not a second flow) — every API contract below confirmed
// against Meta's own docs before writing this, not guessed.
//
// Deliberately opt-in per tenant (Channel.config.autoPublishEnabled), even
// though connecting Messenger now requests the publishing permission too —
// requesting a permission isn't the same as using it. A Page connected
// purely for DM replies must never suddenly start posting to its public
// feed as a side effect of an unrelated feature.
// ─────────────────────────────────────────────────────────────────────────────

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

type MessengerChannelConfig = {
  pageName?: string;
  instagramBusinessAccountId?: string | null;
  autoPublishEnabled?: boolean;
  tokenEnc?: string;
  tokenValid?: boolean;
  tokenHealthLastCheckedAt?: string;
};

export type PublishResult = { facebook: { ok: boolean; error?: string } | null; instagram: { ok: boolean; error?: string; skippedReason?: string } | null };

async function publishToFacebookPage(pageId: string, pageToken: string, imageUrl: string, caption: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl, caption, access_token: pageToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.id) return { ok: false, error: body?.error?.message || `Page photo post failed (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/** Real 2-step flow confirmed against Meta's own Content Publishing docs:
 *  create a media container, then publish it by container id. JPEG only —
 *  a documented Instagram API limitation, not something P2Less can relax;
 *  a non-JPEG product photo skips Instagram (Facebook still gets it) rather
 *  than silently failing or adding new image-conversion machinery for v1. */
async function publishToInstagram(igBusinessId: string, pageToken: string, imageUrl: string, caption: string): Promise<{ ok: boolean; error?: string; skippedReason?: string }> {
  if (!/\.jpe?g(\?|$)/i.test(imageUrl)) {
    return { ok: false, skippedReason: "Instagram only accepts JPEG images — this product's photo is a different format, so only the Facebook Page post went out." };
  }
  try {
    const createRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: pageToken }),
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createBody?.id) return { ok: false, error: createBody?.error?.message || `Container creation failed (${createRes.status})` };

    const publishRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: createBody.id, access_token: pageToken }),
    });
    const publishBody = await publishRes.json().catch(() => ({}));
    if (!publishRes.ok || !publishBody?.id) return { ok: false, error: publishBody?.error?.message || `Publish failed (${publishRes.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/** Best-effort, never throws — a social-publish failure must never block or
 *  roll back the actual product creation that triggered it, same discipline
 *  as dispatchWebhook()'s fire-and-forget calls elsewhere in this codebase. */
export async function autoPublishProduct(tenantId: string, product: { name: string; description: string | null; price: number; currency: string; imageUrl?: string | null }): Promise<PublishResult | null> {
  if (!product.imageUrl) return null; // both destinations require an image; nothing to post without one
  const imageUrl = product.imageUrl;

  const channel = await db.channel.findFirst({ where: { tenantId, type: "messenger", status: "active" } });
  const cfg = channel?.config as MessengerChannelConfig | null;
  if (!cfg?.autoPublishEnabled) return null;

  const token = decryptJSON<{ accessToken?: string }>(cfg.tokenEnc)?.accessToken;
  const pageId = channel?.address;
  if (!token || !pageId) return null;

  const caption = `${product.name} — ${product.currency} ${product.price.toLocaleString("en-US")}${product.description ? `\n\n${product.description}` : ""}`;

  const igBusinessId = cfg.instagramBusinessAccountId;
  const facebook = await publishToFacebookPage(pageId, token, imageUrl, caption);
  const instagram = igBusinessId ? await publishToInstagram(igBusinessId, token, imageUrl, caption) : null;

  return { facebook, instagram };
}

export async function setAutoPublishEnabled(tenantId: string, enabled: boolean): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const channel = await db.channel.findFirst({ where: { tenantId, type: "messenger", status: "active" } });
  if (!channel) return { ok: false, error: "Connect a Facebook Page first, on the Channels page." };
  const cfg = channel.config as MessengerChannelConfig;
  await db.channel.update({ where: { id: channel.id }, data: { config: { ...cfg, autoPublishEnabled: enabled } } });
  // Not a hard block — Facebook-only publishing is still real and useful on
  // its own — but the admin should know Instagram won't get posts until a
  // Business account is actually linked to the connected Page, a real
  // Meta-side step P2Less can't do on their behalf.
  const warning = enabled && !cfg.instagramBusinessAccountId
    ? "Enabled for your Facebook Page. Your connected Page has no linked Instagram Business account yet, so Instagram posts will be skipped until one is linked on Meta's side."
    : undefined;
  return { ok: true, warning };
}

// ─────────────────────────────────────────────────────────────────────────────
// Access-token health monitoring — the gap explicitly flagged (not an
// afterthought) when Phase 8c's core build shipped: a Page/Instagram token
// can be silently revoked (password change, app access removed) and posting
// would just quietly stop with nobody noticing, defeating the whole "no
// human ever needs to log back in and check" point of this feature.
// ─────────────────────────────────────────────────────────────────────────────

/** Real Graph API debug_token endpoint, confirmed against Meta's own docs
 *  before writing this: {app-id}|{app-secret} is the documented "app access
 *  token" format, valid as the caller credential for inspecting ANY token
 *  issued to this same app — no per-tenant admin credential needed to check. */
async function checkPageTokenHealth(pageToken: string): Promise<{ valid: boolean; error?: string }> {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET; // same shared Meta App as WhatsApp/Messenger
  if (!appId || !appSecret) return { valid: true }; // can't check without app credentials — don't false-alarm every tenant for our own config gap
  try {
    const appToken = `${appId}|${appSecret}`;
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${encodeURIComponent(pageToken)}&access_token=${encodeURIComponent(appToken)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.data) return { valid: false, error: body?.error?.message || `debug_token failed (${res.status})` };
    return { valid: !!body.data.is_valid, error: body.data.error?.message };
  } catch (e) {
    return { valid: true, error: e instanceof Error ? e.message : "network error" }; // a network hiccup isn't evidence the token is bad — don't false-alarm on our own connectivity issue
  }
}

/** Registered as social_token_health_sweep in instrumentation.ts. Checks
 *  every tenant's connected Facebook Page token (Messenger replies AND, if
 *  enabled, product auto-publish both depend on the same token) and queues a
 *  real per-TENANT notification the moment one goes bad — not a platform
 *  Incident, deliberately: one client's Facebook password change is a
 *  per-tenant configuration event, not evidence P2Less's own infrastructure
 *  is broken, and conflating the two would misuse the Incident model (AI
 *  provider outages, M-Pesa callback silence) for something structurally
 *  different. queueNotification()'s own per-day dedupe key means a token
 *  that STAYS invalid re-notifies at most once/day, not every sweep tick. */
export async function runSocialTokenHealthSweep(): Promise<{ checked: number; invalid: number }> {
  const channels = await db.channel.findMany({ where: { type: "messenger", status: "active" } });
  let invalid = 0;
  for (const channel of channels) {
    const cfg = channel.config as MessengerChannelConfig;
    const token = decryptJSON<{ accessToken?: string }>(cfg.tokenEnc)?.accessToken;
    if (!token) continue;

    const health = await checkPageTokenHealth(token);
    await db.channel.update({
      where: { id: channel.id },
      data: { config: { ...cfg, tokenValid: health.valid, tokenHealthLastCheckedAt: new Date().toISOString() } },
    });

    if (!health.valid) {
      invalid++;
      const pageLabel = cfg.pageName ?? channel.address ?? "your Facebook Page";
      const affected = cfg.autoPublishEnabled ? "Messenger replies and product auto-publishing" : "Messenger replies";
      await queueNotification(
        "social_token_invalid",
        `${pageLabel}'s connection to P2Less has stopped working (${health.error ?? "the access token is no longer valid"}) — reconnect it on the Channels page to keep ${affected} working.`,
        { tenantId: channel.tenantId },
      ).catch(() => {});
    }
  }
  return { checked: channels.length, invalid };
}
