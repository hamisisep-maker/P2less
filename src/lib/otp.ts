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

/** Shared hash/expiry/attempt-limit checks for both step_up and onboard_signup
 *  challenges — only what happens AFTER a successful match differs (minting
 *  an AuthSession only makes sense once a contact actually exists). */
async function verifyChallengeCore(challengeId: string, code: string) {
  const c = await db.otpChallenge.findUnique({ where: { id: challengeId } });
  if (!c) return { result: { ok: false, reason: "not_found", message: "No active verification request." } as VerifyResult, challenge: null };
  if (c.consumedAt) return { result: { ok: false, reason: "consumed", message: "This code was already used." } as VerifyResult, challenge: c };
  if (c.expiresAt < new Date()) {
    return { result: { ok: false, reason: "expired", message: "That code has expired. Please request a new one." } as VerifyResult, challenge: c };
  }
  if (c.attempts >= c.maxAttempts) {
    return { result: { ok: false, reason: "too_many", message: "Too many incorrect attempts. Please start again." } as VerifyResult, challenge: c };
  }
  const match = safeEqual(sha256(code.trim()), c.codeHash);
  if (!match) {
    await db.otpChallenge.update({ where: { id: c.id }, data: { attempts: { increment: 1 } } });
    const left = c.maxAttempts - (c.attempts + 1);
    return {
      result: {
        ok: false, reason: "mismatch",
        message: left > 0 ? `That code is incorrect. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Please start again.",
      } as VerifyResult,
      challenge: c,
    };
  }
  await db.otpChallenge.update({ where: { id: c.id }, data: { consumedAt: new Date() } });
  return { result: { ok: true } as VerifyResult, challenge: c };
}

export async function verifyOtp(challengeId: string, code: string): Promise<VerifyResult> {
  const { result, challenge } = await verifyChallengeCore(challengeId, code);
  if (result.ok && challenge?.contactId && challenge.tenantId) {
    await db.authSession.create({
      data: { tenantId: challenge.tenantId, contactId: challenge.contactId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return result;
}

/** True if the contact has an unexpired verified session. */
export async function hasVerifiedSession(contactId: string): Promise<boolean> {
  const s = await db.authSession.findFirst({
    where: { contactId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return !!s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone-only verification for /onboard self-service signup — no tenant or
// contact exists yet (that's the point: verify the number BEFORE creating
// them), so this is a genuinely separate pair from issueOtp/verifyOtp above,
// sharing only the underlying hash/expiry/attempt mechanics via
// verifyChallengeCore. Never mints an AuthSession — the caller (actions.ts)
// proceeds straight to tenant creation on a successful result.
// ─────────────────────────────────────────────────────────────────────────────

export async function issuePhoneOtp(phone: string, ip: string | null): Promise<IssuedOtp | { error: string }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.otpChallenge.count({ where: { phone, purpose: "onboard_signup", createdAt: { gte: oneHourAgo } } });
  if (recent >= MAX_ACTIVE_PER_HOUR) {
    return { error: "Too many verification attempts for this number. Please try again later." };
  }
  const code = randomOtp(6);
  const challenge = await db.otpChallenge.create({
    data: { phone, ip, purpose: "onboard_signup", codeHash: sha256(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  return { challengeId: challenge.id, code };
}

export async function verifyPhoneOtp(challengeId: string, code: string): Promise<VerifyResult> {
  const { result } = await verifyChallengeCore(challengeId, code);
  return result;
}

/** How many DIFFERENT signups have actually completed (not just started) from
 *  this IP in the last 24h, including the one just verified — used by
 *  requestOnboardOtpAction's caller to decide whether this looks like
 *  clustered trial abuse worth a human admin's attention. Counts completed
 *  signups, not mere attempts, since a genuine visitor retrying a typo'd
 *  code isn't suspicious the way several DIFFERENT orgs signing up from one
 *  IP in a day is. */
export async function countRecentCompletedSignupsFromIp(ip: string): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return db.otpChallenge.count({
    where: { purpose: "onboard_signup", ip, consumedAt: { not: null, gte: oneDayAgo } },
  });
}
