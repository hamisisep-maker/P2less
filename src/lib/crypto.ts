import "server-only";
import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Field-level encryption for connector credentials (AES-256-GCM).
// Credentials (API keys, passwords, OAuth secrets) are encrypted at rest and
// only decrypted inside the connector engine at call time. They are NEVER
// returned to clients or written to logs.
// ─────────────────────────────────────────────────────────────────────────────

function key(): Buffer {
  const raw = process.env.CREDENTIAL_KEY || "";
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 32) return buf;
  // Derive a stable 32-byte key from whatever is provided (dev convenience).
  return crypto.createHash("sha256").update(raw || "p2less-dev-credential-key").digest();
}

/** Encrypt a JSON-serializable value → compact "v1:iv:tag:ciphertext" (base64). */
export function encryptJSON(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Decrypt a value produced by encryptJSON. Returns null on any tampering. */
export function decryptJSON<T = unknown>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  try {
    const [v, ivb64, tagb64, ctb64] = blob.split(":");
    if (v !== "v1") return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(ivb64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagb64, "base64"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctb64, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(pt.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** One-way hash for OTP codes / PINs / API keys (not reversible). */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Timing-safe comparison of two hex digests. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Cryptographically-random numeric OTP of `digits` length. */
export function randomOtp(digits = 6): string {
  const max = 10 ** digits;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(digits, "0");
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function requestId(): string {
  return "req_" + crypto.randomBytes(8).toString("hex");
}

export function hmacSign(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
