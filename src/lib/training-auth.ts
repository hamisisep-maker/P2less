import "server-only";
import { db } from "./db";
import { sha256, hmacSign, safeEqual, decryptJSON } from "./crypto";
import { rateLimit } from "./rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// Authentication + verification for the two training-platform routes
// (POST /api/training/evaluate, POST /api/training/findings). Full contract:
// the training platform's own docs/integrations/P2LESS.md — this file is the
// P2Less-side implementation of that document's §3 (auth) and §4 (errors);
// if this file's behavior and that doc ever disagree, the doc is stale and
// needs fixing in the same change, not this file bent to match it silently.
//
// Deliberately NOT the same mechanism as api-auth.ts's withApiKey — that's
// tenant-scoped developer API access; this is one platform-level service
// credential (TrainingIntegrationCredential, prisma/schema.prisma), and it
// additionally requires a valid HMAC signature over the raw body, not just a
// bearer token, because the caller here is another backend service, not a
// browser-driven developer integration.
// ─────────────────────────────────────────────────────────────────────────────

export const HAMZONE_API_KEY_HEADER = "x-hamzone-api-key";
export const HAMZONE_TIMESTAMP_HEADER = "x-hamzone-timestamp";
export const HAMZONE_SIGNATURE_HEADER = "x-hamzone-signature";

const REPLAY_WINDOW_MS = 5 * 60_000;

export type TrainingErrorCode =
  | "unauthorized"
  | "invalid_signature"
  | "timestamp_out_of_range"
  | "invalid_payload"
  | "rate_limited"
  | "internal_error";

export function trainingError(code: TrainingErrorCode, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export type TrainingCredential = { id: string; name: string; scopes: string[] };

/** Verifies the request's signature against the RAW body (never a re-parsed/
 *  re-stringified copy — different key order or whitespace would silently
 *  break this) and checks the timestamp is within the replay window. Returns
 *  the resolved credential on success, or a ready-to-return error Response
 *  on failure — callers just do `if (result instanceof Response) return
 *  result;`. */
export async function authenticateTrainingRequest(
  req: Request,
  rawBody: string,
  requiredScope: "training.evaluate" | "training.findings",
): Promise<TrainingCredential | Response> {
  const apiKey = req.headers.get(HAMZONE_API_KEY_HEADER);
  const timestampHeader = req.headers.get(HAMZONE_TIMESTAMP_HEADER);
  const signature = req.headers.get(HAMZONE_SIGNATURE_HEADER);
  if (!apiKey || !timestampHeader || !signature) {
    return trainingError("unauthorized", "Missing X-Hamzone-API-Key / X-Hamzone-Timestamp / X-Hamzone-Signature.", 401);
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > REPLAY_WINDOW_MS) {
    return trainingError("timestamp_out_of_range", "X-Hamzone-Timestamp is missing, invalid, or more than 5 minutes from server time.", 401);
  }

  const record = await db.trainingIntegrationCredential.findUnique({ where: { keyHash: sha256(apiKey) } });
  if (!record || record.revokedAt) {
    // The RESPONSE stays deliberately generic (don't let a caller
    // distinguish "revoked" from "never existed" — that's an enumeration
    // leak) but the SERVER LOG is specific, since an operator watching
    // logs after disabling a credential (the kill switch, /admin/
    // integrations) needs to see it actually taking effect immediately.
    console.error(record?.revokedAt ? `[training-auth] rejected: credential '${record.name}' is disabled.` : "[training-auth] rejected: unknown API key.");
    return trainingError("unauthorized", "Unknown or revoked API key.", 401);
  }
  if (!(record.scopes as string[]).includes(requiredScope)) {
    return trainingError("unauthorized", `This credential lacks the '${requiredScope}' scope.`, 401);
  }

  const signingSecret = decryptJSON<{ secret: string }>(record.encryptedSigningSecret)?.secret;
  if (!signingSecret) {
    return trainingError("internal_error", "Credential is misconfigured.", 500);
  }
  const expected = `sha256=${hmacSign(signingSecret, `${timestamp}.${rawBody}`)}`;
  if (signature.length !== expected.length || !safeEqual(signature, expected)) {
    return trainingError("invalid_signature", "Signature does not match request body.", 401);
  }

  const limit = rateLimit(`training:${record.id}`, { max: 60, windowMs: 60_000 });
  if (!limit.ok) {
    return trainingError("rate_limited", "Too many requests — slow down.", 429);
  }

  db.trainingIntegrationCredential.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { id: record.id, name: record.name, scopes: record.scopes as string[] };
}
