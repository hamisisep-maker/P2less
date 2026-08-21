// TEMPORARY — checks/registers the app-level Messenger webhook subscription
// and retroactively subscribes the already-connected Hamzone Page (which
// was connected before subscribePageToWebhook() existed). Removed after use.
import { db } from "@/lib/db";
import { decryptJSON } from "@/lib/crypto";
import { subscribePageToWebhook } from "@/lib/messenger";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

export async function GET() {
  const appId = process.env.WHATSAPP_APP_ID!;
  const appSecret = process.env.WHATSAPP_APP_SECRET!;
  const appToken = `${appId}|${appSecret}`;

  // 1. Check current app-level webhook subscriptions.
  const subsRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`);
  const subsBody = await subsRes.json().catch(() => ({}));

  // 2. Register the "page" object subscription pointing to our webhook, if missing.
  const callbackUrl = "https://p2less-app-production.up.railway.app/api/channels/messenger/webhook";
  const verifyToken = process.env.MESSENGER_VERIFY_TOKEN || "p2less-verify";
  const registerRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${appId}/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      object: "page",
      callback_url: callbackUrl,
      fields: "messages",
      verify_token: verifyToken,
      access_token: appToken,
    }),
  });
  const registerBody = await registerRes.json().catch(() => ({}));

  // 3. Retroactively subscribe the already-connected Page.
  const channel = await db.channel.findFirst({ where: { type: "messenger", status: "active" } });
  let pageSubResult: unknown = "no channel found";
  if (channel) {
    const cfg = channel.config as { tokenEnc?: string } | null;
    const token = decryptJSON<{ accessToken?: string }>(cfg?.tokenEnc)?.accessToken;
    if (token) {
      pageSubResult = await subscribePageToWebhook(channel.address!, token);
    } else {
      pageSubResult = "no token found";
    }
  }

  return Response.json({
    existingSubscriptions: subsBody,
    registerAttempt: { status: registerRes.status, body: registerBody },
    pageSubscription: pageSubResult,
  });
}
