// Idempotent: upserts the integration catalog into the Integration table.
// Never touches `enabled` on an existing row — that's an admin decision.
//
// The catalog is INLINED here (not imported from src/lib/integrations-registry.ts)
// because that file (and everything it transitively pulls in, e.g. mpesa.ts)
// carries `import "server-only"`, which only resolves inside Next's bundler —
// a plain `tsx` script has no bundler and can't import it. This mirrors the
// existing project convention (see prisma/seed.ts inlining crypto.ts's
// encryptJSON rather than importing it). Keep this list in sync with
// src/lib/integrations-registry.ts's INTEGRATIONS_CATALOG by hand.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CATALOG = [
  { key: "whatsapp_cloud_api", category: "messaging", name: "WhatsApp Cloud API", provider: "Meta", docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api", providerDashboardUrl: "https://business.facebook.com/wa/manage", billingUrl: "https://business.facebook.com/billing_hub" },
  { key: "mpesa_stk", category: "payments", name: "M-Pesa STK Push", provider: "Safaricom Daraja", docsUrl: "https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate", providerDashboardUrl: "https://developer.safaricom.co.ke/user/me/apps", billingUrl: "https://developer.safaricom.co.ke" },
  { key: "mpesa_paybill", category: "payments", name: "M-Pesa PayBill", provider: "Safaricom Daraja (C2B)", docsUrl: "https://developer.safaricom.co.ke/APIs/CustomerToBusinessRegisterURL", providerDashboardUrl: "https://developer.safaricom.co.ke/user/me/apps" },
  { key: "mpesa_till", category: "payments", name: "M-Pesa Till / Buy Goods", provider: "Safaricom Daraja (C2B)", docsUrl: "https://developer.safaricom.co.ke/APIs/CustomerToBusinessRegisterURL", providerDashboardUrl: "https://developer.safaricom.co.ke/user/me/apps" },
  { key: "bank_transfer", category: "payments", name: "Bank Transfer", provider: "Manual statement reconciliation" },
  { key: "card", category: "payments", name: "Card Payments", provider: "Not integrated" },
  { key: "ai_google", category: "ai", name: "Gemini", provider: "Google", docsUrl: "https://ai.google.dev/docs", providerDashboardUrl: "https://aistudio.google.com", billingUrl: "https://aistudio.google.com/app/billing" },
  { key: "ai_groq", category: "ai", name: "Groq", provider: "Groq", docsUrl: "https://console.groq.com/docs", providerDashboardUrl: "https://console.groq.com", billingUrl: "https://console.groq.com/settings/billing" },
  { key: "ai_cerebras", category: "ai", name: "Cerebras", provider: "Cerebras", docsUrl: "https://inference-docs.cerebras.ai", providerDashboardUrl: "https://cloud.cerebras.ai", billingUrl: "https://cloud.cerebras.ai/platform/billing" },
  { key: "ai_openrouter", category: "ai", name: "OpenRouter", provider: "OpenRouter", docsUrl: "https://openrouter.ai/docs", providerDashboardUrl: "https://openrouter.ai", billingUrl: "https://openrouter.ai/settings/credits" },
  { key: "ai_anthropic", category: "ai", name: "Claude", provider: "Anthropic", docsUrl: "https://docs.anthropic.com", providerDashboardUrl: "https://console.anthropic.com", billingUrl: "https://console.anthropic.com/settings/billing" },
  { key: "ai_openai", category: "ai", name: "OpenAI", provider: "OpenAI", docsUrl: "https://platform.openai.com/docs", providerDashboardUrl: "https://platform.openai.com", billingUrl: "https://platform.openai.com/settings/organization/billing/overview" },
  { key: "ai_xai", category: "ai", name: "Grok", provider: "xAI", docsUrl: "https://docs.x.ai", providerDashboardUrl: "https://console.x.ai", billingUrl: "https://console.x.ai/team/default/billing" },
  { key: "email_provider", category: "notification", name: "Email", provider: "Not configured" },
  { key: "sms_provider", category: "notification", name: "SMS", provider: "Advanta SMS (pending)" },
  { key: "database", category: "infrastructure", name: "Database", provider: "SQLite (Railway volume)" },
  { key: "storage", category: "infrastructure", name: "Storage", provider: "Railway volume" },
];

const PAYMENT_CHANNELS: { key: string; providerGroup: string; implemented: boolean }[] = [
  { key: "mpesa_stk", providerGroup: "mpesa", implemented: true },
  { key: "mpesa_paybill", providerGroup: "mpesa", implemented: true },
  { key: "mpesa_till", providerGroup: "mpesa", implemented: true },
  { key: "bank_transfer", providerGroup: "bank", implemented: true },
  { key: "card", providerGroup: "card", implemented: false },
];

async function main() {
  let created = 0, updated = 0;
  for (const entry of CATALOG) {
    const existing = await db.integration.findUnique({ where: { key: entry.key } });
    await db.integration.upsert({
      where: { key: entry.key },
      create: entry,
      update: { category: entry.category, name: entry.name, provider: entry.provider, docsUrl: entry.docsUrl, providerDashboardUrl: entry.providerDashboardUrl, billingUrl: entry.billingUrl },
    });
    if (existing) updated++; else created++;
  }
  console.log(`✓ Integrations catalog synced: ${created} created, ${updated} updated`);

  let pcCreated = 0, pcUpdated = 0;
  for (const pc of PAYMENT_CHANNELS) {
    const existing = await db.paymentChannel.findUnique({ where: { key: pc.key } });
    await db.paymentChannel.upsert({
      where: { key: pc.key },
      create: { key: pc.key, providerGroup: pc.providerGroup, implemented: pc.implemented },
      update: { providerGroup: pc.providerGroup, implemented: pc.implemented },
    });
    if (existing) pcUpdated++; else pcCreated++;
  }
  console.log(`✓ Payment channels synced: ${pcCreated} created, ${pcUpdated} updated`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
