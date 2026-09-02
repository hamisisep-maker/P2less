import "server-only";
import crypto from "node:crypto";
import { db } from "./db";
import { sendEmail } from "./notification-channels";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 8d — Email as a Mode 1 channel, the
// deliberately-lowest-priority piece (see roadmap doc's own build-order
// note). Reuses Resend end-to-end — the SAME provider/credential already
// configured for Priority 6's outbound notifications, not a new
// integration. Resend's real (recently added) "Inbound" feature confirmed
// against Resend's own docs before writing any of this, not guessed.
//
// Addressing, an explicit product decision (asked, not assumed): every
// tenant gets an address on ONE shared Resend-managed domain —
// <slug>@RESEND_INBOUND_DOMAIN — zero DNS/MX setup required on the
// tenant's side, matching how WhatsApp/Messenger/Telegram all avoid
// needing the tenant's own infrastructure. A tenant's own domain
// (support@theirschool.ac.ke) is a real, deliberately-deferred v2 —
// it needs the tenant to change their own DNS, a real onboarding barrier.
// ─────────────────────────────────────────────────────────────────────────────

function inboundDomain(): string | null {
  return process.env.RESEND_INBOUND_DOMAIN || null;
}
function webhookSecret(): string | null {
  return process.env.RESEND_WEBHOOK_SECRET || null;
}

export function emailInboundConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && inboundDomain() && webhookSecret());
}

/** No external API call — unlike Telegram/Messenger there's no per-tenant
 *  credential to register with the provider; ANY address at the inbound
 *  domain works automatically once Resend's Inbound feature is enabled on
 *  the account (a real one-time manual step on Resend's own dashboard, same
 *  shape as Meta's app-level webhook config every other channel needed).
 *  "Connecting" here just means: derive the address, save the Channel row. */
export async function activateEmailChannel(tenantId: string): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  const domain = inboundDomain();
  if (!domain) return { ok: false, error: "Email isn't configured on this deployment yet (RESEND_INBOUND_DOMAIN missing)." };
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  if (!tenant) return { ok: false, error: "Organization not found." };
  const address = `${tenant.slug}@${domain}`;
  await db.channel.upsert({
    where: { tenantId_type: { tenantId, type: "email" } },
    create: { tenantId, type: "email", address, status: "active", connectionStatus: "connected", config: {} },
    update: { address, status: "active", connectionStatus: "connected" },
  });
  return { ok: true, address };
}

/** Svix's real verification algorithm (confirmed against Svix's own docs,
 *  not guessed) — HMAC-SHA256 over "{svix-id}.{svix-timestamp}.{raw body}",
 *  keyed by the base64-decoded secret AFTER its "whsec_" prefix, checked
 *  against every space-delimited "v1,<sig>" entry in svix-signature (there
 *  can be more than one during a secret rotation) with a timing-safe
 *  compare. Hand-rolled with node:crypto, same as WhatsApp/Messenger's own
 *  HMAC verification, rather than adding a new SDK dependency for one path. */
export function verifyResendWebhookSignature(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }): boolean {
  const secret = webhookSecret();
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;

  // Reject stale deliveries (real replay protection, same 5-minute tolerance
  // convention already used elsewhere in this codebase for time-sensitive checks).
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretKey = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretKey).update(signedContent).digest("base64");

  return headers.signature.split(" ").some((entry) => {
    const sig = entry.startsWith("v1,") ? entry.slice(3) : entry;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

type ReceivedEmail = { text: string | null; html: string | null; from: string; subject: string | null };

/** Webhooks carry metadata only (confirmed against Resend's own docs) — the
 *  real body needs this separate authenticated fetch. */
export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[fetchReceivedEmail] RESEND_API_KEY missing");
    return null;
  }
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      console.error("[fetchReceivedEmail] non-ok response", res.status, await res.text());
      return null;
    }
    const body = await res.json();
    return { text: body.text ?? null, html: body.html ?? null, from: body.from, subject: body.subject ?? null };
  } catch (err) {
    console.error("[fetchReceivedEmail] threw", err);
    return null;
  }
}

/** V1 heuristic, stated honestly not perfect — strips the most common
 *  quoted-reply-chain markers (">" quote lines, "On ... wrote:" headers,
 *  "----- Original Message -----" dividers) so a reply doesn't feed the
 *  entire prior thread back into handleInbound() as if it were new text.
 *  No channel before this needed this class of parsing (chat messages have
 *  no equivalent of a quoted email thread). */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^\s*>/.test(l) || /^On .+wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l));
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}

/** Best-effort plain text: prefer the real text part; only strip HTML tags
 *  as a fallback when a sender's client sent HTML-only, same honesty
 *  convention as everywhere else — never invent structure that isn't there. */
export function extractPlainText(email: ReceivedEmail): string {
  const raw = email.text ?? (email.html ? email.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : "");
  return stripQuotedReply(raw.trim());
}

type TenantEmailBranding = {
  assistantName?: string; logoText?: string; primaryColor?: string;
  logoUrl?: string; phone?: string; website?: string;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Branded HTML wrapper around a plain-text reply body — a white card
 *  (logo, message, then an org contact footer) centered on a light gray
 *  page background, matching the same boxed layout already used for this
 *  codebase's other transactional emails. Table-based markup deliberately,
 *  not flex/grid — the only layout approach that renders consistently
 *  across Gmail/Outlook/Apple Mail. All content pulled from the tenant's
 *  own Branding settings; any field left unset is simply omitted, never a
 *  placeholder. */
function renderBrandedEmailHtml(orgName: string, branding: TenantEmailBranding, bodyText: string): string {
  const accent = branding.primaryColor || "#0F6B5C";
  const logoHtml = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(orgName)}" style="max-height:56px;max-width:220px;display:block;margin:0 auto;" />`
    : `<div style="font:600 20px sans-serif;color:${accent};text-align:center;">${escapeHtml(branding.logoText || orgName)}</div>`;

  const bodyHtml = escapeHtml(bodyText).split(/\r?\n/).map((line) => `<p style="margin:0 0 12px;">${line || "&nbsp;"}</p>`).join("");

  const contactLines = [
    branding.phone ? `<span style="color:#4A4F49;">Call us:</span> <a href="tel:${escapeHtml(branding.phone)}" style="color:${accent};text-decoration:none;">${escapeHtml(branding.phone)}</a>` : "",
    branding.website ? `<span style="color:#4A4F49;">Visit us:</span> <a href="${escapeHtml(branding.website)}" style="color:${accent};text-decoration:none;">${escapeHtml(branding.website)}</a>` : "",
  ].filter(Boolean).join(" &nbsp;&nbsp;|&nbsp;&nbsp; ");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F0EB;padding:32px 16px;font-family:sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:16px;border:1px solid #E5E5E5;">
      <tr><td style="padding:40px 32px 32px;">
        ${logoHtml}
      </td></tr>
      <tr><td style="padding:0 32px 24px;color:#1B1F1C;font-size:15px;line-height:1.5;">
        ${bodyHtml}
      </td></tr>
      ${contactLines ? `<tr><td style="padding:20px 32px 32px;border-top:1px solid #E5E5E5;text-align:center;font-size:13px;">${contactLines}</td></tr>` : ""}
    </table>
  </td></tr>
</table>`;
}

export async function sendEmailReply(
  to: string,
  subject: string,
  body: string,
  opts: { tenantId: string; fromEmailAddress?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: opts.tenantId }, select: { name: true, branding: true } });
  const branding = (tenant?.branding as TenantEmailBranding | null) ?? {};
  const orgName = branding.assistantName || tenant?.name || "P2Less";
  const from = opts.fromEmailAddress ? `${orgName} <${opts.fromEmailAddress}>` : undefined;
  const html = renderBrandedEmailHtml(orgName, branding, body);

  const result = await sendEmail({ to, subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`, text: body, html, from });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
