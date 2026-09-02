import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Real delivery adapters for the Notification Engine (notifications.ts). Every
// provider credential in this codebase lives in env vars (WHATSAPP_ACCESS_TOKEN,
// MPESA_CONSUMER_KEY, GEMINI_API_KEY, ...), never a DB-encrypted vault — email
// follows the exact same established convention, not a new pattern.
// ─────────────────────────────────────────────────────────────────────────────

export type ChannelSendResult = { ok: true } | { ok: false; error: string };

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** Real Resend API call — no mock fallback, since a notification that's never
 *  actually sendable should stay honestly "no_provider_configured" (see
 *  notifications.ts) rather than pretend to succeed. */
export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string; from?: string }): Promise<ChannelSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured" };
  const from = opts.from || process.env.RESEND_FROM_EMAIL || "P2Less <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, text: opts.text, ...(opts.html ? { html: opts.html } : {}) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Dispatches through whichever channel a Notification row asks for. Returns
 *  a special "no_provider_configured" outcome (not a retryable failure) for
 *  channels P2Less genuinely has no way to send on yet — WhatsApp specifically
 *  because P2Less has no outbound number of its OWN to a tenant admin (each
 *  tenant's number represents THEM to THEIR customers, not P2Less to them),
 *  and SMS because no provider is wired in. Never fake a send. */
export async function dispatchChannel(channel: string, opts: { to: string | null; subject: string; text: string }): Promise<ChannelSendResult | { ok: false; error: string; noProvider: true }> {
  if (channel === "email") {
    if (!isEmailConfigured()) return { ok: false, error: "No email provider configured", noProvider: true };
    if (!opts.to) return { ok: false, error: "No recipient email resolved" };
    return sendEmail({ to: opts.to, subject: opts.subject, text: opts.text });
  }
  return { ok: false, error: `No provider configured for channel "${channel}"`, noProvider: true };
}
