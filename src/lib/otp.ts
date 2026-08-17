import "server-only";
import { db } from "./db";
import { randomOtp, sha256, safeEqual } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// OTP step-up authentication. Codes are hashed at rest, expire, are rate-limited
// by attempt count, and are single-use. A successful verification mints a short
// AuthSession so the contact isn't re-challenged on every sensitive request.
// ─────────────────────────────────────────────────────────────────────────────

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ACTIVE_PER_HOUR = 5; // basic rate limit on issuance

export type IssuedOtp = { challengeId: string; code: string };

/** Create an OTP challenge for a contact. Returns the plaintext code so the
 *  channel transport can deliver it (in production, via SMS/WhatsApp to the
 *  registered number — never echoed back into the same chat). */
export async function issueOtp(tenantId: string, contactId: string): Promise<IssuedOtp | { error: string }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.otpChallenge.count({
    where: { contactId, createdAt: { gte: oneHourAgo } },
  });
  if (recent >= MAX_ACTIVE_PER_HOUR) {
    return { error: "Too many verification attempts. Please try again later." };
  }
  const code = randomOtp(6);
  const challenge = await db.otpChallenge.create({
    data: {
      tenantId,
      contactId,
      purpose: "step_up",
      codeHash: sha256(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  return { challengeId: challenge.id, code };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "too_many" | "mismatch" | "consumed"; message: string };

export async function verifyOtp(challengeId: string, code: string): Promise<VerifyResult> {
  const c = await db.otpChallenge.findUnique({ where: { id: challengeId } });
  if (!c) return { ok: false, reason: "not_found", message: "No active verification request." };
  if (c.consumedAt) return { ok: false, reason: "consumed", message: "This code was already used." };
  if (c.expiresAt < new Date()) {
    return { ok: false, reason: "expired", message: "That code has expired. Please request a new one." };
  }
  if (c.attempts >= c.maxAttempts) {
    return { ok: false, reason: "too_many", message: "Too many incorrect attempts. Please start again." };
  }
  const match = safeEqual(sha256(code.trim()), c.codeHash);
  if (!match) {
    await db.otpChallenge.update({ where: { id: c.id }, data: { attempts: { increment: 1 } } });
    const left = c.maxAttempts - (c.attempts + 1);
    return {
      ok: false,
      reason: "mismatch",
      message: left > 0 ? `That code is incorrect. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Please start again.",
    };
  }
  await db.otpChallenge.update({ where: { id: c.id }, data: { consumedAt: new Date() } });
  await db.authSession.create({
    data: { tenantId: c.tenantId, contactId: c.contactId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return { ok: true };
}

/** True if the contact has an unexpired verified session. */
export async function hasVerifiedSession(contactId: string): Promise<boolean> {
  const s = await db.authSession.findFirst({
    where: { contactId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return !!s;
}
