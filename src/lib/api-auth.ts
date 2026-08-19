import "server-only";
import { db } from "./db";
import { sha256 } from "./crypto";
import { rateLimit } from "./rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// Developer API authentication. Requests present a tenant API key as
// `Authorization: Bearer p2l_...`. Keys are stored hashed; we look up by hash,
// scope everything to the owning tenant, and record last use.
// ─────────────────────────────────────────────────────────────────────────────

export type ApiActor = {
  tenantId: string;
  apiKeyId: string;
  scopes: string[];
};

export async function authenticateApiKey(req: Request): Promise<ApiActor | null> {
  const header = req.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(p2l_[A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const key = m[1];
  const record = await db.apiKey.findFirst({ where: { keyHash: sha256(key), revokedAt: null } });
  if (!record) return null;
  // Best-effort last-used timestamp (don't block the request).
  db.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { tenantId: record.tenantId, apiKeyId: record.id, scopes: (record.scopes as string[]) ?? [] };
}

/** Standard 401 for the developer API. */
export function apiUnauthorized(): Response {
  return Response.json(
    { error: "unauthorized", message: "Provide a valid API key as 'Authorization: Bearer p2l_...'." },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}

/** Wrap a handler with API-key auth + a scope check + a basic per-key rate
 *  limit — closes a real gap the Priority 6 system audit found: this
 *  surface previously checked auth+scope only, never request volume. */
export async function withApiKey(
  req: Request,
  scope: string | null,
  handler: (actor: ApiActor) => Promise<Response>,
): Promise<Response> {
  const actor = await authenticateApiKey(req);
  if (!actor) return apiUnauthorized();
  if (scope && !actor.scopes.includes(scope) && !actor.scopes.includes("*")) {
    return Response.json({ error: "forbidden", message: `This key lacks the '${scope}' scope.` }, { status: 403 });
  }
  const limit = rateLimit(`apikey:${actor.apiKeyId}`, { max: 120, windowMs: 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: "rate_limited", message: "Too many requests — slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) } },
    );
  }
  return handler(actor);
}
