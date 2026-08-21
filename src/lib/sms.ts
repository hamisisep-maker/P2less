import "server-only";

// SMS delivery for /onboard's phone OTP verification — Advanta (Kenya-focused,
// cheap per-SMS) as primary, Africa's Talking as automatic fallback if Advanta
// fails or isn't configured. Same primary+failover shape already proven for AI
// providers (ai.ts), just two fixed providers rather than a rotating pool —
// no per-provider multi-key rotation needed here.
//
// NEITHER provider has been live-tested against a real account in this build —
// both integrations are written strictly to their documented API contracts
// (Advanta: https://www.advantasms.com/bulksms-api, Africa's Talking:
// https://developers.africastalking.com/docs/sms/sending), not verified
// end-to-end, since no real credentials were available while building this.
// Verify with a real test send before relying on this in production.

export type SmsResult = { ok: true; provider: "advanta" | "africastalking" } | { ok: false; error: string };

async function sendViaAdvanta(to: string, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const apikey = process.env.ADVANTA_API_KEY;
  const partnerID = process.env.ADVANTA_PARTNER_ID;
  const shortcode = process.env.ADVANTA_SHORTCODE;
  if (!apikey || !partnerID || !shortcode) return { ok: false, error: "not configured" };
  try {
    const res = await fetch("https://quicksms.advantasms.com/api/services/sendsms/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apikey, partnerID, mobile: to, message, shortcode }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    // Advanta's own docs literally spell this field "respose-code" (missing an
    // "n") — tolerating the correctly-spelled form too in case they fix it.
    const code = j?.["respose-code"] ?? j?.["response-code"];
    if (String(code) === "200") return { ok: true };
    const body = JSON.stringify(j);
    console.error(`[sms:advanta] status=${res.status} body=${body}`);
    return { ok: false, error: (j?.["response-description"] as string | undefined) ?? `status ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error(`[sms:advanta] error=${msg}`);
    return { ok: false, error: msg };
  }
}

async function sendViaAfricasTalking(to: string, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const username = process.env.AFRICASTALKING_USERNAME || "sandbox";
  if (!apiKey) return { ok: false, error: "not configured" };
  const base = username === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
  try {
    const res = await fetch(`${base}/version1/messaging`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", apiKey },
      body: new URLSearchParams({ username, to, message }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => null)) as { SMSMessageData?: { Recipients?: { statusCode?: number; status?: string }[] } } | null;
    const recipient = j?.SMSMessageData?.Recipients?.[0];
    // 100=Processed, 101=Sent, 102=Queued — all count as "handed off successfully".
    if (recipient?.statusCode && [100, 101, 102].includes(recipient.statusCode)) return { ok: true };
    const body = JSON.stringify(j);
    console.error(`[sms:africastalking] status=${res.status} body=${body}`);
    return { ok: false, error: recipient?.status ?? `status ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error(`[sms:africastalking] error=${msg}`);
    return { ok: false, error: msg };
  }
}

/** Sends an SMS via Advanta first, automatically falling back to Africa's
 *  Talking if Advanta fails or has no credentials configured. `to` must be
 *  E.164 format (e.g. "+254712345678") — Africa's Talking documents this
 *  explicitly; Advanta's docs don't specify, so this is unverified for them
 *  until tested against a real account. */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const primary = await sendViaAdvanta(to, message);
  if (primary.ok) return { ok: true, provider: "advanta" };
  const fallback = await sendViaAfricasTalking(to, message);
  if (fallback.ok) return { ok: true, provider: "africastalking" };
  return { ok: false, error: `Advanta: ${primary.error}; Africa's Talking: ${fallback.error}` };
}

/** True if at least one provider has real credentials configured — used to
 *  decide whether to attempt real delivery vs. fall back to the same
 *  "Demo only — your code is X" honesty pattern already used for the
 *  webchat/widget OTP flows when there's no real out-of-band channel. */
export function smsEnabled(): boolean {
  return !!(process.env.ADVANTA_API_KEY || process.env.AFRICASTALKING_API_KEY);
}
