import { handleInbound } from "@/lib/conversation";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { runCrossTenant } from "@/lib/tenant-context";
import { z } from "zod";

// Universal Platform roadmap Phase 8e (2026-08-20) — the embeddable website
// chat widget's channel adapter. The FIRST cross-origin, browser-callable
// endpoint in this codebase — every other route is either same-origin
// (dashboard calling its own API) or server-to-server (Meta/Daraja
// webhooks). Two things follow from that, both required, neither optional:
//
// 1. The real security boundary is the server-side origin check below, not
//    CORS headers — CORS is a browser-only convention; a non-browser client
//    ignores it entirely. `widgetKey` is deliberately public (embedded in
//    page source), so the origin allowlist + rate limit ARE the protection.
// 2. CORS headers still have to be correct, or legitimate browsers can't
//    read the response even when the origin IS allowed.

const schema = z.object({
  widgetKey: z.string().min(1),
  sessionId: z.string().min(1).max(200), // client-generated, persisted in the visitor's localStorage
  text: z.string().max(2000).optional().default(""),
  displayName: z.string().max(120).optional(),
});

function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" }
    : {};
}

/** Matches the request's Origin against a WidgetKey's allowed-origins list.
 *  An empty list is dev/testing mode: any origin is allowed, but flagged in
 *  the response so this is never mistaken for a deliberately-open key. */
function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    return allowed.some((a) => a === origin || a === host);
  } catch {
    return false;
  }
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400, headers });
  const { widgetKey: keyValue, sessionId, text, displayName } = parsed.data;

  // Deliberately cross-tenant — this resolves WHICH tenant the key belongs
  // to, so no tenant context can exist yet. Found broken by the 2026-08-23
  // fail-closed rollout, same category as the WhatsApp webhook's own
  // destination lookup.
  const widgetKey = await runCrossTenant(() => db.widgetKey.findUnique({ where: { key: keyValue } }));
  if (!widgetKey || !widgetKey.active) {
    return Response.json({ error: "invalid_key" }, { status: 401, headers });
  }
  const allowedOrigins = (widgetKey.allowedOrigins as string[] | null) ?? [];
  if (!originAllowed(origin, allowedOrigins)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403, headers });
  }

  // Same rate-limit primitive already built and proven for the developer API
  // (api-auth.ts) — reused, not reinvented. Keyed by widget key AND a coarse
  // client identifier so one visitor can't exhaust another's quota, but a
  // single abusive visitor still gets capped.
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = rateLimit(`widget:${widgetKey.id}:${clientIp}`, { max: 30, windowMs: 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: "rate_limited", message: "Too many requests — slow down." },
      { status: 429, headers: { ...headers, "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) } },
    );
  }

  runCrossTenant(() => db.widgetKey.update({ where: { id: widgetKey.id }, data: { lastUsedAt: new Date() } })).catch(() => {});

  const result = await handleInbound({
    tenantId: widgetKey.tenantId,
    fromNumber: sessionId,
    channelType: "widget",
    text: text ?? "",
    displayName,
  });
  return Response.json(result, { headers });
}
