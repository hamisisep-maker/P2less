/**
 * One-off: reset a contact's conversation state on a tenant's live number, then
 * send them a REAL WhatsApp message via the Graph API introducing the platform's
 * current capabilities. Used to (re)prime the standing test number.
 *
 * Usage: npx tsx scripts/reset-and-announce.ts <tenantSlug> <phone>
 */
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const db = new PrismaClient();

async function sendWhatsAppText(fromNumberId: string, to: string, body: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
  if (!token) return { ok: false, error: "WHATSAPP_ACCESS_TOKEN not set" };
  const res = await fetch(`https://graph.facebook.com/${version}/${fromNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body } }),
  });
  const json = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, json } : { ok: false, error: JSON.stringify(json).slice(0, 300) };
}

async function main() {
  const [slug, phoneArg] = process.argv.slice(2);
  if (!slug || !phoneArg) { console.error("Usage: npx tsx scripts/reset-and-announce.ts <tenantSlug> <phone>"); process.exit(1); }
  const phone = phoneArg.startsWith("+") ? phoneArg : "+" + phoneArg.replace(/[^\d]/g, "");

  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant) { console.error(`No tenant "${slug}"`); process.exit(1); }
  const number = await db.whatsAppNumber.findFirst({ where: { tenantId: tenant.id } });
  if (!number) { console.error(`No WhatsApp number for "${slug}"`); process.exit(1); }
  const contact = await db.contact.findFirst({ where: { tenantId: tenant.id, address: phone } });
  if (!contact) { console.error(`No contact ${phone} on "${slug}"`); process.exit(1); }

  // Clear any stale pending flow (OTP/confirm/param) so testing starts clean.
  await db.conversation.updateMany({
    where: { tenantId: tenant.id, contactId: contact.id, numberId: number.id },
    data: { status: "open", context: {} },
  });
  console.log(`✓ Reset conversation state for ${phone} on ${tenant.name}.`);

  const first = (contact.displayName ?? "").split(" ")[0];
  const message = `👋 Hi ${first || "there"}! This number is now the standing test line for everything we've built in P2Less. Here's what you can try:

*🏫 School services (as Kevin's parent):*
Fee balance, exam results, attendance, next appointment, book/cancel a meeting — just ask naturally, e.g. "what's Kevin's fee balance?"

*🗣️ Natural conversation:*
Talk normally — greetings, "how are you", follow-ups like "and his attendance?" — it remembers context and replies in English or Swahili, matching you.

*🎙️ Voice notes:*
Send a voice note instead of typing — it transcribes and answers.

*📊 Data analysis (new!):*
Send me a *CSV/spreadsheet* — I'll analyze trends, totals, and answer questions about it. Try it with any spreadsheet you have.

*💳 Wallet & credits:*
You get 30 free credits. Reply *PAY 100* to top up via M-Pesa. Reply *balance* to check your credits.

*📄 Documents:*
Fee statements and results come back as real PDFs.

Give it a try — send anything!`;

  const res = await sendWhatsAppText(number.phoneNumberId, phone, message);
  if (res.ok) console.log(`✓ Sent capabilities message to ${phone} via ${number.phoneNumberId}.`);
  else console.error(`✗ Send failed: ${res.error}`);

  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
